"""
FEATURE IMPORTANCE ANALYSIS
===========================
Analyze which features contribute most to model predictions.

This script:
1. Trains Random Forest models
2. Extracts feature importance scores
3. Shows which features matter most
4. Creates visualization of importance

Usage:
    python 04_feature_importance.py
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
import warnings
warnings.filterwarnings('ignore')

print("=" * 100)
print("FEATURE IMPORTANCE ANALYSIS")
print("=" * 100)

# Load full dataset
df_full = pd.read_csv('../COMBINED_SENSOR_PLANT_DATA.csv')

# Do 70/30 split
df_train, df_test = train_test_split(df_full, test_size=0.30, random_state=42)

# Prepare features
feature_cols = ['ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity', 'plant_no', 'day']
df_train['plant_no'] = df_train['plant_no'].astype(float)
df_train['day'] = pd.to_datetime(df_train['date']).dt.dayofyear
df_test['plant_no'] = df_test['plant_no'].astype(float)
df_test['day'] = pd.to_datetime(df_test['date']).dt.dayofyear

# Scale features
scaler = StandardScaler()
X_train = scaler.fit_transform(df_train[feature_cols])
X_test = scaler.transform(df_test[feature_cols])

# Targets
targets = {
    'height': df_train['height'].values,
    'weight': df_train['weight'].values,
    'leaves': df_train['leaves'].values,
    'branches': df_train['branches'].values
}

# Train Random Forest for each target and extract feature importance
importance_data = {}

for target_name, y_train in targets.items():
    model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train)
    
    importance = model.feature_importances_
    importance_data[target_name] = importance

# Display results
print(f"\nFEATURE IMPORTANCE BY TARGET:\n")

for target_name, importance in importance_data.items():
    print(f"\n{target_name.upper()}:")
    print("-" * 50)
    
    # Create dataframe for sorting
    importance_df = pd.DataFrame({
        'Feature': feature_cols,
        'Importance': importance,
        'Percentage': importance * 100
    }).sort_values('Importance', ascending=False)
    
    for idx, row in importance_df.iterrows():
        bar = "█" * int(row['Percentage'] / 2)
        print(f"  {row['Feature']:15} {row['Percentage']:6.2f}% {bar}")

# Calculate average importance across all targets
print(f"\n\nAVERAGE IMPORTANCE ACROSS ALL TARGETS:")
print("-" * 50)
avg_importance = np.mean([importance_data[t] for t in targets.keys()], axis=0)
avg_df = pd.DataFrame({
    'Feature': feature_cols,
    'Importance': avg_importance,
    'Percentage': avg_importance * 100
}).sort_values('Importance', ascending=False)

for idx, row in avg_df.iterrows():
    bar = "█" * int(row['Percentage'] / 2)
    print(f"  {row['Feature']:15} {row['Percentage']:6.2f}% {bar}")

# Categorize features
sensor_features = ['ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity']
engineered_features = ['plant_no', 'day']

sensor_importance = avg_df[avg_df['Feature'].isin(sensor_features)]['Percentage'].sum()
engineered_importance = avg_df[avg_df['Feature'].isin(engineered_features)]['Percentage'].sum()

print(f"\n\nFEATURE CATEGORY IMPORTANCE:")
print("-" * 50)
print(f"  Sensor Features (5):       {sensor_importance:6.2f}%")
print(f"    - pH, DO, TDS, Temp, Humidity")
print(f"  Engineered Features (2):   {engineered_importance:6.2f}%")
print(f"    - Plant ID, Day of Year")

print(f"\n\nKEY INSIGHTS:")
print("-" * 50)
if sensor_importance > engineered_importance:
    print(f"  ✓ Sensor data dominates predictions ({sensor_importance:.1f}%)")
    print(f"    Models rely heavily on environmental conditions")
else:
    print(f"  ⚠ Engineered features (plant ID + time) dominate ({engineered_importance:.1f}%)")
    print(f"    Models may be learning plant-specific patterns")

print(f"\n✅ Feature importance analysis complete!")
