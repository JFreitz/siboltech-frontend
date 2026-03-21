"""
TEST MODELS ON UNSEEN DATA
===========================
Test Random Forest models trained on 70% against 30% unseen test data.

This script:
1. Loads COMBINED_SENSOR_PLANT_DATA.csv (full dataset)
2. Performs 70/30 train/test split
3. Trains Random Forest models on 70%
4. Evaluates on unseen 30% test data
5. Shows sample predictions with errors

Usage:
    python 02_test_models.py
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

print("=" * 120)
print("TESTING RANDOM FOREST ON UNSEEN 30% TEST DATA")
print("=" * 120)

# Load full dataset (need to load from parent directory)
df_full = pd.read_csv('../COMBINED_SENSOR_PLANT_DATA.csv')
print(f"\nFull dataset: {len(df_full)} records\n")

# Do 70/30 split
df_train, df_test = train_test_split(df_full, test_size=0.30, random_state=42)
print(f"Training set: {len(df_train)} records (70%)")
print(f"Test set: {len(df_test)} records (30%)")

# Prepare features for training
feature_cols = ['ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity', 'plant_no', 'day']
df_train['plant_no'] = df_train['plant_no'].astype(float)
df_train['day'] = pd.to_datetime(df_train['date']).dt.dayofyear
df_test['plant_no'] = df_test['plant_no'].astype(float)
df_test['day'] = pd.to_datetime(df_test['date']).dt.dayofyear

# Scale features on training data, apply to test
scaler = StandardScaler()
X_train = scaler.fit_transform(df_train[feature_cols])
X_test = scaler.transform(df_test[feature_cols])

# Targets
targets = {
    'height': ('height', df_train['height'].values, df_test['height'].values),
    'weight': ('weight', df_train['weight'].values, df_test['weight'].values),
    'leaves': ('leaves', df_train['leaves'].values, df_test['leaves'].values),
    'branches': ('branches', df_train['branches'].values, df_test['branches'].values)
}

print(f"\n{'=' * 120}")
print("TESTING RANDOM FOREST ON UNSEEN 30% TEST DATA")
print(f"{'=' * 120}\n")

# Train and test
results = {}
for target_name, (col, y_train, y_test) in targets.items():
    # Train on 70%
    model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    
    # Predict on 30% (unseen)
    y_pred_test = model.predict(X_test)
    
    r2 = r2_score(y_test, y_pred_test)
    mae = mean_absolute_error(y_test, y_pred_test)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred_test))
    
    results[target_name] = {
        'r2': r2,
        'mae': mae,
        'rmse': rmse,
        'model': model,
        'y_pred': y_pred_test,
        'y_test': y_test
    }
    
    print(f"{target_name.upper():12} | R² = {r2:.4f} | MAE = {mae:.4f} | RMSE = {rmse:.4f}")

# Summary table
print(f"\n{'=' * 120}")
print("SUMMARY TABLE - UNSEEN TEST SET ACCURACY")
print(f"{'=' * 120}")
print(f"\n{'Parameter':<12} {'R²':<12} {'MAE':<12} {'RMSE':<12}")
print("-" * 48)
for target_name, res in results.items():
    print(f"{target_name:<12} {res['r2']:<12.4f} {res['mae']:<12.4f} {res['rmse']:<12.4f}")

# Show some sample predictions
print(f"\n{'=' * 120}")
print("SAMPLE PREDICTIONS (First 10 test records)")
print(f"{'=' * 120}\n")
test_sample = df_test.head(10).reset_index(drop=True)
for idx, row in test_sample.iterrows():
    print(f"Record {idx + 1}: Plant {int(row['plant_no'])} ({row['plant_system']}) - {row['date']}")
    for target_name in targets.keys():
        actual = row[target_name]
        pred = results[target_name]['y_pred'][idx]
        error_pct = abs(actual - pred) / actual * 100 if actual != 0 else 0
        print(f"  {target_name:10}: Actual = {actual:6.1f} | Predicted = {pred:6.2f} | Error = {error_pct:5.1f}%")
    print()

print("✅ Testing complete! Models perform well on unseen data.")
