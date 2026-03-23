"""
ML Prediction module for plant growth metrics.
Loads pre-trained models and provides prediction interface.
"""
import os
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from pathlib import Path

class PlantGrowthPredictor:
    """Load and use pre-trained ML models for plant metrics prediction."""
    
    TARGETS = ["height", "length", "weight", "leaves", "branches"]
    FEATURE_COLS = [
        "ave_ph", "ave_do", "ave_tds", "ave_temp", "ave_humidity",
        "plant_no", "day_of_year", "day_of_week_num", "week_of_year", 
        "month", "doy_sin", "doy_cos", "plant_system"
    ]
    
    def __init__(self, models_dir=None):
        """Initialize predictor with models directory path."""
        if models_dir is None:
            # Default to ml_models/ml-rpi-deploy/STEP_BY_STEP/models
            models_dir = os.path.join(
                os.path.dirname(__file__), 
                'ml_models', 'ml-rpi-deploy', 'STEP_BY_STEP', 'models'
            )
        
        self.models_dir = models_dir
        self.models = {}
        self.loaded = False
        
        # Try to load all models
        self._load_models()
    
    def _load_models(self):
        """Load all trained models from disk."""
        try:
            for target in self.TARGETS:
                model_path = os.path.join(self.models_dir, f"{target}_best_model.joblib")
                if os.path.exists(model_path):
                    self.models[target] = joblib.load(model_path)
                    print(f"[ML] Loaded {target} model from {model_path}", flush=True)
                else:
                    print(f"[ML] Model not found: {model_path}", flush=True)
            
            self.loaded = len(self.models) == len(self.TARGETS)
            if self.loaded:
                print(f"[ML] Successfully loaded all {len(self.TARGETS)} models", flush=True)
        except Exception as e:
            print(f"[ML] Error loading models: {e}", flush=True)
            self.loaded = False
    
    def predict(self, sensor_data, plant_id, plant_system, date_obj=None):
        """
        Make predictions for all plant metrics.
        
        Args:
            sensor_data: dict with keys {ave_ph, ave_do, ave_tds, ave_temp, ave_humidity}
            plant_id: integer plant identifier (1-6)
            plant_system: string 'aeroponics' or 'dwc'
            date_obj: datetime object (defaults to now)
        
        Returns:
            dict with predicted values for each metric
        """
        if not self.loaded:
            return {target: None for target in self.TARGETS}
        
        if date_obj is None:
            date_obj = datetime.now(timezone.utc)
        
        # Build feature vector as a DataFrame (models expect this format)
        features = self._prepare_features(sensor_data, plant_id, plant_system, date_obj)
        
        # Convert to DataFrame for model input
        df = pd.DataFrame([features], columns=self.FEATURE_COLS)
        
        # Make predictions
        predictions = {}
        for target in self.TARGETS:
            try:
                if target in self.models:
                    pred = self.models[target].predict(df)[0]
                    predictions[target] = float(max(0, pred))  # Ensure non-negative
                else:
                    predictions[target] = None
            except Exception as e:
                print(f"[ML] Error predicting {target}: {e}", flush=True)
                predictions[target] = None
        
        return predictions
    
    def _prepare_features(self, sensor_data, plant_id, plant_system, date_obj):
        """Prepare feature vector for model input."""
        # Ensure plant_system is lowercase
        plant_system = plant_system.lower()
        if 'aero' in plant_system:
            plant_system = 'aeroponics'
        elif 'dwc' in plant_system or 'deep' in plant_system:
            plant_system = 'dwc'
        
        # Extract date features
        day_of_year = date_obj.timetuple().tm_yday
        day_of_week = date_obj.weekday()
        week_of_year = date_obj.isocalendar()[1]
        month = date_obj.month
        
        # Cyclic encoding for seasonality
        doy_sin = np.sin(2.0 * np.pi * day_of_year / 366.0)
        doy_cos = np.cos(2.0 * np.pi * day_of_year / 366.0)
        
        # Build feature list in correct order
        features = [
            sensor_data.get('ave_ph', 6.5),
            sensor_data.get('ave_do', 5.0),
            sensor_data.get('ave_tds', 600),
            sensor_data.get('ave_temp', 24),
            sensor_data.get('ave_humidity', 60),
            float(plant_id),
            float(day_of_year),
            float(day_of_week),
            float(week_of_year),
            float(month),
            float(doy_sin),
            float(doy_cos),
            plant_system  # Will be one-hot encoded by the pipeline
        ]
        
        return features
    
    def is_available(self):
        """Check if predictor is ready to use."""
        return self.loaded
