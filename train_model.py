#!/usr/bin/env python3
"""
SIBOLTECH Plant Growth Prediction – Model Training
===================================================
Reads from the actual database tables:
  - plant_readings   – daily manual plant measurements
  - sensor_readings   – automated sensor data every 30s
  - actuator_events   – relay ON/OFF logs

Builds a merged daily feature set and trains 3 models per target,
selecting the best by test R².

Actuator schedule context (hard-coded as known constants):
  - Grow Lights (relay 6 Aero, 8 DWC): 6 AM - 6 PM daily = 12h
  - Misting Pump (relay 4, aeroponics): 5s ON every 15 min
  - Air Pump (relay 7): continuous when AUTO
  - Exhaust fans (relay 5 out, 9 in): reactive, temp-controlled

Usage:
    python train_model.py              # train on real data
    python train_model.py --mock       # generate mock data then train
    python train_model.py --export     # export merged CSV only (no training)
"""

import os
import sys
import json
import pickle
import numpy as np
import pandas as pd
from datetime import datetime, timedelta, timezone
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sqlalchemy import text

# -- project imports -------------------------------------------------------
from db import SessionLocal, SensorReading, PlantReading, ActuatorEvent, init_db

# -- configuration ---------------------------------------------------------
TRAINING_RATIO = 0.75          # 75% train, 25% test (time-based split)
MIN_DAYS       = 7             # minimum days to attempt training

TARGETS = ['height', 'length', 'width', 'leaf_count', 'branch_count']

# DB column -> target mapping  (PlantReading model stores width as weight)
DB_COL_MAP = {
    'height':       'height',
    'length':       'length',
    'width':        'weight',   # weight column holds width values
    'leaf_count':   'leaves',
    'branch_count': 'branches',
}

MODELS = {
    'LinearRegression':    lambda: LinearRegression(),
    'RandomForest':        lambda: RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1),
    'GradientBoosting':    lambda: GradientBoostingRegressor(n_estimators=100, random_state=42),
}

MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODEL_DIR, exist_ok=True)

RELAY_NAMES = {
    1: 'leafy_green', 2: 'ph_down', 3: 'ph_up', 4: 'misting',
    5: 'exhaust_out', 6: 'grow_lights_aero', 7: 'air_pump',
    8: 'grow_lights_dwc', 9: 'exhaust_in',
}


# ===========================================================================
#  DATA LOADING
# ===========================================================================

def load_plant_data():
    """Load plant measurements from plant_readings, daily avg per plant/system."""
    session = SessionLocal()
    try:
        rows = session.execute(text("""
            SELECT
                DATE(timestamp)   AS day,
                plant_id,
                farming_system,
                AVG(height)       AS height,
                AVG(length)       AS length,
                AVG(weight)       AS width,
                AVG(leaves)       AS leaf_count,
                AVG(branches)     AS branch_count
            FROM plant_readings
            GROUP BY DATE(timestamp), plant_id, farming_system
            ORDER BY day
        """)).fetchall()

        df = pd.DataFrame(rows, columns=[
            'day', 'plant_id', 'farming_system',
            'height', 'length', 'width', 'leaf_count', 'branch_count'
        ])
        df['day'] = pd.to_datetime(df['day'])
        return df
    finally:
        session.close()


def load_sensor_daily():
    """Daily average sensor readings, pivoted so each sensor is a column."""
    session = SessionLocal()
    try:
        rows = session.execute(text("""
            SELECT
                DATE(timestamp) AS day,
                sensor,
                AVG(value)      AS avg_value
            FROM sensor_readings
            WHERE sensor IN ('temperature_c','humidity','ph','tds_ppm','do_mg_l')
            GROUP BY DATE(timestamp), sensor
            ORDER BY day
        """)).fetchall()

        df = pd.DataFrame(rows, columns=['day', 'sensor', 'avg_value'])
        if df.empty:
            return pd.DataFrame()

        rename = {
            'temperature_c': 'temperature',
            'humidity':      'humidity',
            'ph':            'ph',
            'tds_ppm':       'tds',
            'do_mg_l':       'do',
        }
        df['sensor'] = df['sensor'].map(rename).fillna(df['sensor'])
        df_pivot = df.pivot_table(index='day', columns='sensor', values='avg_value').reset_index()
        df_pivot['day'] = pd.to_datetime(df_pivot['day'])
        return df_pivot
    finally:
        session.close()


def load_actuator_daily():
    """Compute daily ON-hours per relay from actuator_events."""
    session = SessionLocal()
    try:
        rows = session.execute(text("""
            SELECT timestamp, relay_id, state
            FROM actuator_events
            ORDER BY relay_id, timestamp
        """)).fetchall()
    finally:
        session.close()

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows, columns=['timestamp', 'relay_id', 'state'])
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values(['relay_id', 'timestamp'])

    records = []

    for relay_id, grp in df.groupby('relay_id'):
        events = grp.to_dict('records')
        for i, evt in enumerate(events):
            if evt['state'] == 1:  # ON event
                off_ts = None
                for j in range(i + 1, len(events)):
                    if events[j]['relay_id'] == relay_id and events[j]['state'] == 0:
                        off_ts = events[j]['timestamp']
                        break
                if off_ts is None:
                    off_ts = evt['timestamp'].replace(hour=23, minute=59, second=59)

                current = evt['timestamp']
                while current.date() <= off_ts.date():
                    day_end = current.replace(hour=23, minute=59, second=59)
                    end = min(off_ts, day_end)
                    secs = (end - current).total_seconds()
                    if secs > 0:
                        records.append({
                            'day': current.date(),
                            'relay_id': relay_id,
                            'on_seconds': secs,
                        })
                    current = (current + timedelta(days=1)).replace(hour=0, minute=0, second=0)

    if not records:
        return pd.DataFrame()

    act_df = pd.DataFrame(records)
    act_df['day'] = pd.to_datetime(act_df['day'])
    act_df['on_hours'] = act_df['on_seconds'] / 3600.0

    pivot = act_df.pivot_table(index='day', columns='relay_id', values='on_hours', aggfunc='sum').reset_index()
    pivot.columns = ['day'] + [f'relay_{int(c)}_hours' for c in pivot.columns[1:]]
    return pivot


# ===========================================================================
#  FEATURE ENGINEERING
# ===========================================================================

def build_dataset():
    """Merge all data sources into a single training-ready DataFrame."""
    print("\n  Loading data ...")

    plant_df  = load_plant_data()
    sensor_df = load_sensor_daily()
    act_df    = load_actuator_daily()

    if plant_df.empty:
        print("  No plant readings found! Use the Training tab to enter daily measurements.")
        return None

    print(f"   Plant data:    {len(plant_df)} records, "
          f"{plant_df['day'].nunique()} unique days")
    if not sensor_df.empty:
        print(f"   Sensor data:   {sensor_df.shape[0]} day-rows")
    else:
        print("   Warning: No sensor data - will train without environmental features")
    if not act_df.empty:
        print(f"   Actuator data: {act_df.shape[0]} day-rows")
    else:
        print("   Warning: No actuator events - will add scheduled defaults")

    # -- merge -------------------------------------------------------------
    df = plant_df.copy()

    if not sensor_df.empty:
        df = pd.merge(df, sensor_df, on='day', how='left')

    if not act_df.empty:
        df = pd.merge(df, act_df, on='day', how='left')

    # -- day number from first measurement ---------------------------------
    start_date = df['day'].min()
    df['day_num'] = (df['day'] - start_date).dt.days + 1

    # -- fill missing relay hours with schedule defaults -------------------
    # Grow Lights: 12h/day (6am-6pm)
    for col in ['relay_6_hours', 'relay_8_hours']:
        if col not in df.columns:
            df[col] = 12.0
        else:
            df[col] = df[col].fillna(12.0)

    # Misting (relay 4): aero = 5s/15min = ~0.33h/day; others = 0
    if 'relay_4_hours' not in df.columns:
        df['relay_4_hours'] = df['farming_system'].apply(
            lambda s: 0.33 if s == 'aeroponics' else 0.0
        )
    else:
        df['relay_4_hours'] = df.apply(
            lambda r: r['relay_4_hours'] if pd.notna(r['relay_4_hours'])
            else (0.33 if r['farming_system'] == 'aeroponics' else 0.0),
            axis=1
        )

    # Air pump (relay 7): assume 24h when AUTO
    if 'relay_7_hours' not in df.columns:
        df['relay_7_hours'] = 24.0
    else:
        df['relay_7_hours'] = df['relay_7_hours'].fillna(24.0)

    # Exhaust fans default ~8h reactive
    for col in ['relay_5_hours', 'relay_9_hours']:
        if col not in df.columns:
            df[col] = 8.0
        else:
            df[col] = df[col].fillna(8.0)

    # Other relays default 0
    for rid in [1, 2, 3]:
        col = f'relay_{rid}_hours'
        if col not in df.columns:
            df[col] = 0.0
        else:
            df[col] = df[col].fillna(0.0)

    # -- lag features (previous day's growth) ------------------------------
    df = df.sort_values(['plant_id', 'farming_system', 'day'])
    for target in TARGETS:
        if target in df.columns:
            df[f'prev_{target}'] = df.groupby(['plant_id', 'farming_system'])[target].shift(1)

    lag_cols = [f'prev_{t}' for t in TARGETS if f'prev_{t}' in df.columns]
    df[lag_cols] = df[lag_cols].fillna(0)

    # -- fill remaining NaN sensor values ----------------------------------
    sensor_cols = ['temperature', 'humidity', 'ph', 'tds', 'do']
    for c in sensor_cols:
        if c in df.columns:
            df[c] = df[c].fillna(df[c].median())

    n_days = df['day_num'].nunique()
    print(f"\n   Merged dataset: {len(df)} rows x {df.shape[1]} columns, "
          f"spanning {n_days} days")

    return df


def get_feature_columns(df):
    """Return the ordered list of feature columns present in df."""
    ordered = [
        'day_num',
        'farming_system_encoded',
        'plant_id',
        # Sensors
        'temperature', 'humidity', 'ph', 'tds', 'do',
        # Actuator duty cycles
        'relay_1_hours', 'relay_2_hours', 'relay_3_hours',
        'relay_4_hours', 'relay_5_hours', 'relay_6_hours',
        'relay_7_hours', 'relay_8_hours', 'relay_9_hours',
        # Lag features
        'prev_height', 'prev_length', 'prev_width',
        'prev_leaf_count', 'prev_branch_count',
    ]
    return [c for c in ordered if c in df.columns]


# ===========================================================================
#  TRAINING
# ===========================================================================

def train_and_evaluate(df):
    """Train 3 models for each target, pick best by test R2."""

    le = LabelEncoder()
    df['farming_system_encoded'] = le.fit_transform(df['farming_system'])

    feature_cols = get_feature_columns(df)
    print(f"\n  Features ({len(feature_cols)}): {feature_cols}")

    # Time-based split
    day_nums = sorted(df['day_num'].unique())
    n_train = max(1, int(len(day_nums) * TRAINING_RATIO))
    train_days = set(day_nums[:n_train])
    test_days  = set(day_nums[n_train:])

    train_df = df[df['day_num'].isin(train_days)]
    test_df  = df[df['day_num'].isin(test_days)]

    print(f"\n  Split: {len(train_days)} training days ({len(train_df)} rows), "
          f"{len(test_days)} testing days ({len(test_df)} rows)")

    if len(train_df) < 5:
        print("  Not enough training data! Need at least 5 rows.")
        return None, None

    if test_df.empty:
        print("  Warning: No test data - evaluating on training set")
        test_df = train_df

    X_train = train_df[feature_cols].fillna(0).values
    X_test  = test_df[feature_cols].fillna(0).values

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled  = scaler.transform(X_test)

    # Save artifacts
    with open(os.path.join(MODEL_DIR, 'scaler.pkl'), 'wb') as f:
        pickle.dump(scaler, f)
    with open(os.path.join(MODEL_DIR, 'label_encoder.pkl'), 'wb') as f:
        pickle.dump(le, f)
    with open(os.path.join(MODEL_DIR, 'feature_cols.json'), 'w') as f:
        json.dump(feature_cols, f)

    results = {}
    best_models = {}

    for target in TARGETS:
        if target not in df.columns or df[target].isna().all():
            print(f"\n  Skipping {target} - no data")
            continue

        print(f"\n{'=' * 55}")
        print(f"  Target: {target.upper()}")
        print('=' * 55)

        y_train = train_df[target].fillna(0).values
        y_test  = test_df[target].fillna(0).values

        target_results = {}

        for model_name, make_model in MODELS.items():
            clf = make_model()
            clf.fit(X_train_scaled, y_train)

            pred_train = clf.predict(X_train_scaled)
            pred_test  = clf.predict(X_test_scaled)

            train_r2 = r2_score(y_train, pred_train)
            test_r2  = r2_score(y_test, pred_test) if len(y_test) > 1 else 0
            test_mae = mean_absolute_error(y_test, pred_test)
            test_rmse = np.sqrt(mean_squared_error(y_test, pred_test))

            target_results[model_name] = {
                'model': clf,
                'train_r2': train_r2,
                'test_r2':  test_r2,
                'test_mae': test_mae,
                'test_rmse': test_rmse,
            }

            print(f"  {model_name:<22}  "
                  f"Train R2={train_r2:+.4f}  Test R2={test_r2:+.4f}  "
                  f"MAE={test_mae:.3f}  RMSE={test_rmse:.3f}")

        best_name = max(target_results, key=lambda n: target_results[n]['test_r2'])
        best_models[target] = {
            'model_name': best_name,
            'model':      target_results[best_name]['model'],
            'metrics':    target_results[best_name],
        }

        print(f"  Best -> {best_name}  (R2 = {target_results[best_name]['test_r2']:.4f})")

        with open(os.path.join(MODEL_DIR, f'{target}_model.pkl'), 'wb') as f:
            pickle.dump(target_results[best_name]['model'], f)

        results[target] = target_results

    # Save model info
    model_info = {
        'trained_at':    datetime.now().isoformat(),
        'training_days': len(train_days),
        'testing_days':  len(test_days),
        'total_rows':    len(df),
        'feature_cols':  feature_cols,
        'best_models': {
            t: {
                'model_name': info['model_name'],
                'test_r2':    round(info['metrics']['test_r2'], 4),
                'test_mae':   round(info['metrics']['test_mae'], 4),
                'test_rmse':  round(info['metrics']['test_rmse'], 4),
            }
            for t, info in best_models.items()
        },
    }
    with open(os.path.join(MODEL_DIR, 'model_info.json'), 'w') as f:
        json.dump(model_info, f, indent=2)

    return results, best_models


def print_summary(results, best_models):
    print("\n" + "=" * 60)
    print("  TRAINING SUMMARY")
    print("=" * 60)
    print(f"\n  Models compared: Linear Regression, Random Forest, Gradient Boosting")
    print(f"\n  Best model per target:")
    print(f"   {'Target':<16} {'Model':<24} {'R2':>8}  {'MAE':>8}  {'RMSE':>8}")
    print("   " + "-" * 66)
    for target, info in best_models.items():
        m = info['metrics']
        print(f"   {target:<16} {info['model_name']:<24} "
              f"{m['test_r2']:>+8.4f}  {m['test_mae']:>8.3f}  {m['test_rmse']:>8.3f}")
    print(f"\n  Saved to: {os.path.abspath(MODEL_DIR)}/")
    print("   Files: [target]_model.pkl, scaler.pkl, label_encoder.pkl, model_info.json")


# ===========================================================================
#  EXPORT
# ===========================================================================

def export_training_csv(filename="training_data.csv"):
    """Build the merged dataset and export to CSV. Returns file path."""
    df = build_dataset()
    if df is None:
        print("  No data to export.")
        return ""

    out_path = os.path.join(os.path.dirname(__file__), filename)
    df.to_csv(out_path, index=False)
    print(f"\n  Exported {len(df)} rows -> {out_path}")
    return out_path


# ===========================================================================
#  MOCK DATA (for testing the pipeline without real measurements)
# ===========================================================================

def generate_mock_data(days=25):
    """Insert synthetic plant + sensor + actuator data for pipeline testing."""
    print(f"\n  Generating {days} days of mock data ...")
    init_db()
    session = SessionLocal()
    try:
        start = datetime.now(timezone.utc) - timedelta(days=days)
        systems = ['aeroponics', 'dwc', 'traditional']
        sensors_cfg = [
            ('temperature_c', 25, 2, 'C'),
            ('humidity',      60, 8, '%'),
            ('ph',            6.2, 0.4, 'pH'),
            ('tds_ppm',       750, 150, 'ppm'),
            ('do_mg_l',       6.8, 0.8, 'mg/L'),
        ]

        for d in range(days):
            ts = start + timedelta(days=d, hours=8)
            day_factor = d / days

            # Sensor readings (4 per day)
            for hour_offset in [0, 4, 8, 12]:
                sensor_ts = ts + timedelta(hours=hour_offset)
                for name, mean, std, unit in sensors_cfg:
                    val = mean + np.random.normal(0, std * 0.3)
                    session.execute(text("""
                        INSERT INTO sensor_readings (timestamp, sensor, value, unit)
                        VALUES (:ts, :sensor, :val, :unit)
                    """), {'ts': sensor_ts, 'sensor': name, 'val': round(val, 2), 'unit': unit})

            # Plant readings
            for sys_name in systems:
                sys_factor = {'aeroponics': 1.2, 'dwc': 1.1, 'traditional': 1.0}[sys_name]
                for plant_id in range(1, 7):
                    base = day_factor * 15 * sys_factor + np.random.normal(0, 0.5)
                    session.execute(text("""
                        INSERT INTO plant_readings
                        (timestamp, plant_id, farming_system, height, length, weight, leaves, branches)
                        VALUES (:ts, :pid, :sys, :h, :l, :w, :lv, :br)
                    """), {
                        'ts': ts, 'pid': plant_id, 'sys': sys_name,
                        'h': round(max(0, base), 2),
                        'l': round(max(0, base * 0.8 + np.random.normal(0, 0.3)), 2),
                        'w': round(max(0, base * 0.5 + np.random.normal(0, 0.2)), 2),
                        'lv': max(0, int(d * 0.4 * sys_factor + np.random.randint(0, 3))),
                        'br': max(0, int(d * 0.15 * sys_factor + np.random.randint(0, 2))),
                    })

            # Actuator events (lights ON 6am, OFF 6pm)
            for relay_id in [6, 8]:
                on_ts  = ts.replace(hour=6, minute=0, second=0)
                off_ts = ts.replace(hour=18, minute=0, second=0)
                session.execute(text("""
                    INSERT INTO actuator_events (timestamp, relay_id, state)
                    VALUES (:ts, :rid, 1)
                """), {'ts': on_ts, 'rid': relay_id})
                session.execute(text("""
                    INSERT INTO actuator_events (timestamp, relay_id, state)
                    VALUES (:ts, :rid, 0)
                """), {'ts': off_ts, 'rid': relay_id})

        session.commit()
        print(f"  Inserted mock data for {days} days x {len(systems)} systems x 6 plants")
    finally:
        session.close()


# ===========================================================================
#  MAIN
# ===========================================================================

def main():
    print("=" * 60)
    print("  SIBOLTECH Plant Growth - Model Training")
    print("=" * 60)

    if '--mock' in sys.argv:
        generate_mock_data()

    if '--export' in sys.argv:
        export_training_csv()
        return

    df = build_dataset()

    if df is None:
        print("\n  No data yet. Options:")
        print("   1. Enter plant measurements daily via the Training tab")
        print("   2. Run: python train_model.py --mock   (generates test data)")
        return

    n_days = df['day_num'].nunique()
    if n_days < MIN_DAYS:
        print(f"\n  Only {n_days} days of data. Need at least {MIN_DAYS}.")
        print("   Keep entering daily measurements and try again later.")
        return

    result = train_and_evaluate(df)
    if result and result[0]:
        results, best_models = result
        print_summary(results, best_models)
        export_training_csv()
    else:
        print("\n  Training failed. Check data quality.")


if __name__ == '__main__':
    main()
