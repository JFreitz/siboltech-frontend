#!/usr/bin/env python3
"""
SIBOLTECH Plant Growth Prediction - Model Training
Trains 3 ML models and selects the best performer.
- 19 days training data
- 6 days testing data
"""

import os
import json
import pickle
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from db import SessionLocal, SensorReading
from sqlalchemy import text

# Configuration
TRAINING_DAYS = 19
TESTING_DAYS = 6
TOTAL_DAYS = TRAINING_DAYS + TESTING_DAYS  # 25 days total

# Target metrics to predict
TARGETS = ['height', 'length', 'width', 'leaf_count', 'branch_count']

# Models to compare
MODELS = {
    'RandomForest': RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1),
    'GradientBoosting': GradientBoostingRegressor(n_estimators=100, random_state=42),
    'LinearRegression': LinearRegression()
}

MODEL_DIR = 'models'
os.makedirs(MODEL_DIR, exist_ok=True)


def load_sensor_data():
    """Load sensor readings from database and aggregate by day."""
    session = SessionLocal()
    try:
        # Get all sensor readings
        readings = session.execute(text("""
            SELECT 
                DATE(timestamp) as day,
                sensor,
                AVG(value) as avg_value
            FROM sensor_readings
            WHERE timestamp >= DATE('now', '-25 days')
            GROUP BY DATE(timestamp), sensor
            ORDER BY day
        """)).fetchall()
        
        # Pivot to get sensors as columns
        df = pd.DataFrame(readings, columns=['day', 'sensor', 'avg_value'])
        df_pivot = df.pivot(index='day', columns='sensor', values='avg_value').reset_index()
        df_pivot['day'] = pd.to_datetime(df_pivot['day'])
        
        return df_pivot
    finally:
        session.close()


def load_growth_data():
    """Load plant growth measurements from database."""
    session = SessionLocal()
    try:
        # Check if growth_measurements table exists
        result = session.execute(text("""
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='growth_measurements'
        """)).fetchone()
        
        if not result:
            print("⚠️  growth_measurements table not found. Creating...")
            create_growth_table(session)
            return pd.DataFrame()
        
        readings = session.execute(text("""
            SELECT 
                DATE(timestamp) as day,
                farming_system,
                AVG(height_cm) as height,
                AVG(length_cm) as length,
                AVG(width_cm) as width,
                AVG(leaf_count) as leaf_count,
                AVG(branch_count) as branch_count
            FROM growth_measurements
            WHERE timestamp >= DATE('now', '-25 days')
            GROUP BY DATE(timestamp), farming_system
            ORDER BY day
        """)).fetchall()
        
        df = pd.DataFrame(readings, columns=[
            'day', 'farming_system', 'height', 'length', 'width', 'leaf_count', 'branch_count'
        ])
        df['day'] = pd.to_datetime(df['day'])
        
        return df
    finally:
        session.close()


def create_growth_table(session):
    """Create growth_measurements table if it doesn't exist."""
    session.execute(text("""
        CREATE TABLE IF NOT EXISTS growth_measurements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            farming_system TEXT NOT NULL,
            height_cm REAL,
            length_cm REAL,
            width_cm REAL,
            leaf_count INTEGER,
            branch_count INTEGER,
            notes TEXT
        )
    """))
    session.commit()
    print("✅ Created growth_measurements table")


def prepare_dataset():
    """Merge sensor and growth data into training dataset."""
    print("\n📊 Loading data...")
    
    sensor_df = load_sensor_data()
    growth_df = load_growth_data()
    
    if sensor_df.empty:
        print("❌ No sensor data found!")
        return None, None
    
    if growth_df.empty:
        print("❌ No growth measurements found!")
        print("\n💡 To add growth data, use the Training tab in the dashboard")
        print("   or insert directly into the growth_measurements table.")
        return None, None
    
    print(f"   Sensor data: {len(sensor_df)} days")
    print(f"   Growth data: {len(growth_df)} records")
    
    # Merge on day
    df = pd.merge(growth_df, sensor_df, on='day', how='inner')
    
    if df.empty:
        print("❌ No matching data between sensors and growth measurements!")
        return None, None
    
    print(f"   Merged data: {len(df)} records")
    
    # Calculate day number from start
    start_date = df['day'].min()
    df['day_num'] = (df['day'] - start_date).dt.days + 1
    
    return df, start_date


def train_and_evaluate(df):
    """Train 3 models and compare performance."""
    
    # Encode farming_system
    le = LabelEncoder()
    df['farming_system_encoded'] = le.fit_transform(df['farming_system'])
    
    # Save label encoder
    with open(os.path.join(MODEL_DIR, 'label_encoder.pkl'), 'wb') as f:
        pickle.dump(le, f)
    
    # Feature columns
    feature_cols = ['day_num', 'farming_system_encoded']
    
    # Add sensor columns if available
    sensor_cols = ['temperature', 'humidity', 'ph', 'tds', 'do']
    for col in sensor_cols:
        if col in df.columns:
            feature_cols.append(col)
    
    print(f"\n🔧 Features: {feature_cols}")
    
    # Split by day (19 training, 6 testing)
    train_cutoff = df['day_num'].max() - TESTING_DAYS
    train_df = df[df['day_num'] <= train_cutoff]
    test_df = df[df['day_num'] > train_cutoff]
    
    print(f"\n📅 Data Split:")
    print(f"   Training: Days 1-{int(train_cutoff)} ({len(train_df)} samples)")
    print(f"   Testing:  Days {int(train_cutoff)+1}-{int(df['day_num'].max())} ({len(test_df)} samples)")
    
    if len(train_df) < 5:
        print("❌ Not enough training data! Need at least 5 samples.")
        return None
    
    if len(test_df) < 2:
        print("⚠️  Limited test data. Results may not be reliable.")
    
    # Prepare features
    X_train = train_df[feature_cols].fillna(0)
    X_test = test_df[feature_cols].fillna(0)
    
    # Scale features
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)
    
    # Save scaler
    with open(os.path.join(MODEL_DIR, 'scaler.pkl'), 'wb') as f:
        pickle.dump(scaler, f)
    
    # Save feature columns
    with open(os.path.join(MODEL_DIR, 'feature_cols.json'), 'w') as f:
        json.dump(feature_cols, f)
    
    results = {}
    best_models = {}
    
    # Train model for each target metric
    for target in TARGETS:
        if target not in df.columns or df[target].isna().all():
            print(f"\n⚠️  Skipping {target} - no data")
            continue
            
        print(f"\n{'='*50}")
        print(f"🎯 Training models for: {target.upper()}")
        print('='*50)
        
        y_train = train_df[target].fillna(0)
        y_test = test_df[target].fillna(0)
        
        target_results = {}
        
        for model_name, model in MODELS.items():
            # Clone model for fresh training
            if model_name == 'RandomForest':
                clf = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
            elif model_name == 'GradientBoosting':
                clf = GradientBoostingRegressor(n_estimators=100, random_state=42)
            else:
                clf = LinearRegression()
            
            # Train
            clf.fit(X_train_scaled, y_train)
            
            # Predict
            y_pred_train = clf.predict(X_train_scaled)
            y_pred_test = clf.predict(X_test_scaled)
            
            # Metrics
            train_r2 = r2_score(y_train, y_pred_train)
            test_r2 = r2_score(y_test, y_pred_test) if len(y_test) > 1 else 0
            test_mae = mean_absolute_error(y_test, y_pred_test)
            test_rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
            
            target_results[model_name] = {
                'model': clf,
                'train_r2': train_r2,
                'test_r2': test_r2,
                'test_mae': test_mae,
                'test_rmse': test_rmse
            }
            
            print(f"\n📈 {model_name}:")
            print(f"   Train R²: {train_r2:.4f}")
            print(f"   Test R²:  {test_r2:.4f}")
            print(f"   Test MAE: {test_mae:.4f}")
            print(f"   Test RMSE: {test_rmse:.4f}")
        
        # Find best model for this target (by test R²)
        best_name = max(target_results, key=lambda x: target_results[x]['test_r2'])
        best_models[target] = {
            'model_name': best_name,
            'model': target_results[best_name]['model'],
            'metrics': target_results[best_name]
        }
        
        print(f"\n🏆 Best model for {target}: {best_name} (R² = {target_results[best_name]['test_r2']:.4f})")
        
        # Save best model
        model_path = os.path.join(MODEL_DIR, f'{target}_model.pkl')
        with open(model_path, 'wb') as f:
            pickle.dump(target_results[best_name]['model'], f)
        
        results[target] = target_results
    
    # Save model selection info
    model_info = {
        'training_days': TRAINING_DAYS,
        'testing_days': TESTING_DAYS,
        'trained_at': datetime.now().isoformat(),
        'best_models': {
            target: {
                'model_name': info['model_name'],
                'test_r2': info['metrics']['test_r2'],
                'test_mae': info['metrics']['test_mae'],
                'test_rmse': info['metrics']['test_rmse']
            }
            for target, info in best_models.items()
        }
    }
    
    with open(os.path.join(MODEL_DIR, 'model_info.json'), 'w') as f:
        json.dump(model_info, f, indent=2)
    
    return results, best_models


def print_summary(results, best_models):
    """Print final summary."""
    print("\n" + "="*60)
    print("📊 TRAINING SUMMARY")
    print("="*60)
    
    print(f"\n⏱️  Training Period: {TRAINING_DAYS} days")
    print(f"🧪 Testing Period:  {TESTING_DAYS} days")
    print(f"\n🤖 Models Compared:")
    print("   1. Random Forest Regressor")
    print("   2. Gradient Boosting Regressor")
    print("   3. Linear Regression")
    
    print("\n🏆 Best Models Selected:")
    print("-"*50)
    for target, info in best_models.items():
        print(f"   {target.upper():<15} → {info['model_name']:<20} (R² = {info['metrics']['test_r2']:.4f})")
    
    print("\n✅ Models saved to:", os.path.abspath(MODEL_DIR))
    print("   - {target}_model.pkl for each metric")
    print("   - scaler.pkl")
    print("   - label_encoder.pkl")
    print("   - model_info.json")
    
    print("\n💡 Next steps:")
    print("   1. Add /api/predict endpoint to api.py")
    print("   2. Use models to predict plant growth")


def generate_mock_data():
    """Generate mock training data for testing the pipeline."""
    print("\n🔧 Generating mock data for testing...")
    
    session = SessionLocal()
    try:
        create_growth_table(session)
        
        # Generate 25 days of growth data
        start_date = datetime.now() - timedelta(days=25)
        farming_systems = ['Aquaponics', 'Hydroponics', 'Soil-based']
        
        for day in range(25):
            current_date = start_date + timedelta(days=day)
            
            for system in farming_systems:
                # Growth increases over time with some noise
                base_growth = day * 0.5
                system_factor = 1.2 if system == 'Aquaponics' else (1.1 if system == 'Hydroponics' else 1.0)
                
                height = max(0, base_growth * system_factor + np.random.normal(0, 1))
                length = max(0, base_growth * 0.8 * system_factor + np.random.normal(0, 0.5))
                width = max(0, base_growth * 0.6 * system_factor + np.random.normal(0, 0.3))
                leaves = max(0, int(day * 0.3 * system_factor + np.random.randint(0, 3)))
                branches = max(0, int(day * 0.1 * system_factor + np.random.randint(0, 2)))
                
                session.execute(text("""
                    INSERT INTO growth_measurements 
                    (timestamp, farming_system, height_cm, length_cm, width_cm, leaf_count, branch_count)
                    VALUES (:ts, :system, :height, :length, :width, :leaves, :branches)
                """), {
                    'ts': current_date.isoformat(),
                    'system': system,
                    'height': round(height, 2),
                    'length': round(length, 2),
                    'width': round(width, 2),
                    'leaves': leaves,
                    'branches': branches
                })
        
        session.commit()
        print(f"✅ Generated {25 * 3} growth measurements")
        
    finally:
        session.close()


def main():
    print("="*60)
    print("🌱 SIBOLTECH Plant Growth Model Training")
    print("="*60)
    
    df, start_date = prepare_dataset()
    
    if df is None:
        print("\n❓ Would you like to generate mock data for testing? (y/n)")
        choice = input().strip().lower()
        if choice == 'y':
            generate_mock_data()
            df, start_date = prepare_dataset()
    
    if df is None:
        print("\n❌ Cannot proceed without data.")
        return
    
    results, best_models = train_and_evaluate(df)
    
    if results:
        print_summary(results, best_models)


if __name__ == '__main__':
    main()
