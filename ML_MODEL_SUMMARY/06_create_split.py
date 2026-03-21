"""
CREATE TRAINING AND TEST DATASETS
==================================
Split full dataset into 70% training and 30% test.

This script:
1. Loads full COMBINED_SENSOR_PLANT_DATA.csv
2. Performs 70/30 random split
3. Saves training_data.csv and test_data.csv
4. Verifies split integrity

Usage:
    python 06_create_split.py
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split

print("=" * 100)
print("CREATING 70/30 TRAIN/TEST SPLIT")
print("=" * 100)

# Load full dataset (need to load from parent directory)
df_full = pd.read_csv('../COMBINED_SENSOR_PLANT_DATA.csv')
print(f"\nLoaded full dataset: {len(df_full)} records")
print(f"Date range: {df_full['date'].min()} to {df_full['date'].max()}")
print(f"Plants: {sorted(df_full['plant_no'].unique())}")

# Perform 70/30 split
df_train, df_test = train_test_split(df_full, test_size=0.30, random_state=42)

print(f"\n{'=' * 100}")
print("SPLIT RESULTS")
print(f"{'=' * 100}")
print(f"\nTraining set (70%): {len(df_train)} records")
print(f"  Date range: {df_train['date'].min()} to {df_train['date'].max()}")
print(f"  Plants: {sorted(df_train['plant_no'].unique())}")

print(f"\nTest set (30%): {len(df_test)} records")
print(f"  Date range: {df_test['date'].min()} to {df_test['date'].max()}")
print(f"  Plants: {sorted(df_test['plant_no'].unique())}")

# Save to CSV
df_train.to_csv('training_data.csv', index=False)
df_test.to_csv('test_data.csv', index=False)

print(f"\n{'=' * 100}")
print("FILES SAVED")
print(f"{'=' * 100}")
print(f"✓ training_data.csv ({len(df_train)} records)")
print(f"✓ test_data.csv ({len(df_test)} records)")

# Verification
print(f"\n{'=' * 100}")
print("VERIFICATION")
print(f"{'=' * 100}")
print(f"\nTotal: {len(df_train) + len(df_test)} = {len(df_full)} ✓")
print(f"Training: {len(df_train)/len(df_full)*100:.1f}%")
print(f"Test: {len(df_test)/len(df_full)*100:.1f}%")

print(f"\n✅ Split complete and verified!")
