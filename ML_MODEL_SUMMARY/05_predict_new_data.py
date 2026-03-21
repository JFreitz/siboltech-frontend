"""
MAKE PREDICTIONS ON NEW DATA
=============================
Train models and generate predictions for new sensor readings.

This script:
1. Trains Random Forest models on training data
2. Accepts new sensor data
3. Makes predictions for height, weight, leaves, branches
4. Returns predictions with confidence (can add later)

Usage:
    python 05_predict_new_data.py
    
Or import as module:
    from _05_predict_new_data import predict_plant_growth
    prediction = predict_plant_growth(ph=6.2, do=3.8, tds=600, temp=23.5, humidity=63.2, plant_id=1)
"""

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor
import pickle
import warnings
warnings.filterwarnings('ignore')

class PlantGrowthPredictor:
    """Predicts plant growth parameters from sensor data"""
    
    def __init__(self, training_data_path='training_data.csv'):
        """Initialize and train models on training data"""
        print("Initializing Plant Growth Predictor...")
        
        # Load training data
        self.df_train = pd.read_csv(training_data_path)
        
        # Prepare features
        self.feature_cols = ['ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity', 'plant_no', 'day']
        self.df_train['plant_no'] = self.df_train['plant_no'].astype(float)
        self.df_train['day'] = pd.to_datetime(self.df_train['date']).dt.dayofyear
        
        X = self.df_train[self.feature_cols].copy()
        
        # Scale features
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)
        
        # Train models for each target
        self.models = {}
        targets = {
            'height': self.df_train['height'].values,
            'weight': self.df_train['weight'].values,
            'leaves': self.df_train['leaves'].values,
            'branches': self.df_train['branches'].values
        }
        
        for target_name, y in targets.items():
            model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
            model.fit(X_scaled, y)
            self.models[target_name] = model
        
        print("✓ Models trained successfully!")
    
    def predict(self, ph, do, tds, temp, humidity, plant_id, day_of_year=None):
        """
        Make prediction for plant growth parameters
        
        Args:
            ph (float): pH level (0-14)
            do (float): Dissolved Oxygen (0-10 mg/L)
            tds (float): Total Dissolved Solids (0-1000+ ppm)
            temp (float): Temperature (Celsius)
            humidity (float): Humidity (%)
            plant_id (int): Plant ID (1-6 for DWC, 101-106 for AERO)
            day_of_year (int): Day of year (32-77 for Feb 6 - Mar 17)
                               If None, uses current day
        
        Returns:
            dict: Predictions for height, weight, leaves, branches
        """
        
        # Use current day if not provided
        if day_of_year is None:
            from datetime import datetime
            day_of_year = datetime.now().timetuple().tm_yday
        
        # Create feature vector
        X_input = np.array([[ph, do, tds, temp, humidity, plant_id, day_of_year]])
        X_scaled = self.scaler.transform(X_input)
        
        # Make predictions
        predictions = {}
        for target_name, model in self.models.items():
            pred = model.predict(X_scaled)[0]
            predictions[target_name] = float(pred)
        
        return predictions
    
    def predict_batch(self, df):
        """
        Make predictions for multiple records
        
        Args:
            df (DataFrame): Must have columns: ave_ph, ave_do, ave_tds, 
                           ave_temp, ave_humidity, plant_no, day
        
        Returns:
            DataFrame: Original data with added prediction columns
        """
        
        X = df[self.feature_cols].copy()
        X_scaled = self.scaler.transform(X)
        
        result = df.copy()
        
        for target_name, model in self.models.items():
            pred = model.predict(X_scaled)
            result[f'{target_name}_pred'] = pred
        
        return result


# Example usage
if __name__ == '__main__':
    print("=" * 80)
    print("PLANT GROWTH PREDICTOR - EXAMPLE USAGE")
    print("=" * 80)
    
    # Initialize predictor
    predictor = PlantGrowthPredictor('training_data.csv')
    
    # Example 1: Predict for single sensor reading
    print("\n\nExample 1: Single Prediction")
    print("-" * 80)
    print("Sensor reading:")
    print("  pH: 6.2, DO: 3.8, TDS: 600, Temp: 23.5°C, Humidity: 63.2%")
    print("  Plant ID: 1 (DWC), Day: 75")
    
    prediction = predictor.predict(
        ph=6.2,
        do=3.8,
        tds=600,
        temp=23.5,
        humidity=63.2,
        plant_id=1,
        day_of_year=75
    )
    
    print("\nPredictions:")
    for param, value in prediction.items():
        if param == 'height':
            print(f"  {param:10}: {value:6.2f} cm")
        elif param == 'weight':
            print(f"  {param:10}: {value:6.2f} g")
        else:
            print(f"  {param:10}: {value:6.0f}")
    
    # Example 2: Batch prediction
    print("\n\nExample 2: Batch Prediction")
    print("-" * 80)
    
    # Create sample data
    sample_data = pd.DataFrame({
        'ave_ph': [6.2, 6.1, 6.3],
        'ave_do': [3.8, 3.7, 3.9],
        'ave_tds': [600, 550, 650],
        'ave_temp': [23.5, 23.2, 23.8],
        'ave_humidity': [63.2, 62.5, 64.1],
        'plant_no': [1.0, 2.0, 101.0],
        'day': [75, 75, 75]
    })
    
    print(f"Predicting for {len(sample_data)} records...")
    predictions_df = predictor.predict_batch(sample_data)
    
    print("\nResults:")
    print(predictions_df[['plant_no', 'height_pred', 'weight_pred', 'leaves_pred', 'branches_pred']].to_string())
    
    print("\n✅ Predictions complete!")
