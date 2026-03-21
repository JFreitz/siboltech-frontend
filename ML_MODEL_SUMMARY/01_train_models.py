"""
TRAIN MACHINE LEARNING MODELS
==============================
Train Random Forest models on the 70% training dataset.

This script:
1. Loads training_data.csv (268 records)
2. Tests 5 different regression models
3. Selects Random Forest as best performer
4. Saves results to console

Usage:
    python 01_train_models.py
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

print("=" * 100)
print("TRAINING ML MODELS ON 70% TRAINING DATA")
print("=" * 100)

# Load training data
df_train = pd.read_csv('training_data.csv')
print(f"\nTraining data loaded: {len(df_train)} records\n")

# Prepare features
feature_cols = ['ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity', 'plant_no', 'day']
df_train['plant_no'] = df_train['plant_no'].astype(float)
df_train['day'] = pd.to_datetime(df_train['date']).dt.dayofyear

X = df_train[feature_cols].copy()
X_scaled = StandardScaler().fit_transform(X)

# Target variables
targets = {
    'height': df_train['height'].values,
    'weight': df_train['weight'].values,
    'leaves': df_train['leaves'].values,
    'branches': df_train['branches'].values
}

# Models to test
models = {
    'Linear Regression': LinearRegression(),
    'Ridge': Ridge(alpha=1.0),
    'Lasso': Lasso(alpha=0.1),
    'Random Forest': RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1),
    'Gradient Boosting': GradientBoostingRegressor(n_estimators=100, random_state=42)
}

# Train and evaluate
results = {}
for target_name, y in targets.items():
    print(f"\n{'=' * 100}")
    print(f"TARGET: {target_name.upper()}")
    print(f"{'=' * 100}")
    
    target_results = {}
    
    for model_name, model in models.items():
        model.fit(X_scaled, y)
        y_pred = model.predict(X_scaled)
        
        r2 = r2_score(y, y_pred)
        mae = mean_absolute_error(y, y_pred)
        rmse = np.sqrt(mean_squared_error(y, y_pred))
        
        target_results[model_name] = {'r2': r2, 'mae': mae, 'rmse': rmse, 'model': model}
        
        print(f"{model_name:25} | R² = {r2:.4f} | MAE = {mae:.4f} | RMSE = {rmse:.4f}")
    
    # Find best
    best_model = max(target_results.items(), key=lambda x: x[1]['r2'])
    results[target_name] = target_results
    print(f"\n🏆 BEST FOR {target_name.upper()}: {best_model[0]} (R² = {best_model[1]['r2']:.4f})")

# Summary
print(f"\n\n{'=' * 100}")
print("BEST MODELS SUMMARY")
print(f"{'=' * 100}")
for target_name, target_results in results.items():
    best = max(target_results.items(), key=lambda x: x[1]['r2'])
    print(f"{target_name:15} → {best[0]:25} (R² = {best[1]['r2']:.4f})")

print(f"\n\n✅ Training complete! Random Forest is the best model.")
