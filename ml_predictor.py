"""ML prediction module using ML-MARCH24-FINAL system-specific models."""

import os
import joblib
import numpy as np


class PlantGrowthPredictor:
    """Load and run AERO/DWC-specific models from ML-MARCH24-FINAL."""

    TARGETS = ["height", "length", "weight", "leaves", "branches"]
    FEATURE_KEYS = ["ave_ph", "ave_do", "ave_tds", "ave_temp", "ave_humidity"]

    MODEL_FILES = {
        "aeroponics": {
            "height": ("AERO_height_SVR_model.joblib", "SVR"),
            "length": ("AERO_length_MLR_model.joblib", "MLR"),
            "weight": ("AERO_weight_RandomForest_model.joblib", "RandomForest"),
            "leaves": ("AERO_leaves_RandomForest_model.joblib", "RandomForest"),
            "branches": ("AERO_branches_RandomForest_model.joblib", "RandomForest"),
        },
        "dwc": {
            "height": ("DWC_height_SVR_model.joblib", "SVR"),
            "length": ("DWC_length_RandomForest_model.joblib", "RandomForest"),
            "weight": ("DWC_weight_MLR_model.joblib", "MLR"),
            "leaves": ("DWC_leaves_MLR_model.joblib", "MLR"),
            "branches": ("DWC_branches_RandomForest_model.joblib", "RandomForest"),
        },
    }

    SCALER_FILES = {
        "aeroponics": "AERO_scaler.joblib",
        "dwc": "DWC_scaler.joblib",
    }

    def __init__(self, models_dir=None):
        if models_dir is None:
            models_dir = os.path.join(os.path.dirname(__file__), "ML-MARCH24-FINAL")

        self.models_dir = models_dir
        self.models = {"aeroponics": {}, "dwc": {}}
        self.model_types = {"aeroponics": {}, "dwc": {}}
        self.scalers = {"aeroponics": None, "dwc": None}
        self.system_ready = {"aeroponics": False, "dwc": False}

        self._load_models()

    def _normalize_system(self, plant_system):
        s = str(plant_system or "").strip().lower()
        if "aero" in s:
            return "aeroponics"
        if "dwc" in s or "deep" in s or "water" in s:
            return "dwc"
        return ""

    def _load_models(self):
        try:
            for system in ("aeroponics", "dwc"):
                # scaler (required for SVR targets in this model set)
                scaler_name = self.SCALER_FILES[system]
                scaler_path = os.path.join(self.models_dir, scaler_name)
                if os.path.exists(scaler_path):
                    self.scalers[system] = joblib.load(scaler_path)
                    print(f"[ML] Loaded {system} scaler: {scaler_path}", flush=True)
                else:
                    print(f"[ML] Missing {system} scaler: {scaler_path}", flush=True)

                ok_count = 0
                for target, (fname, model_kind) in self.MODEL_FILES[system].items():
                    model_path = os.path.join(self.models_dir, fname)
                    if not os.path.exists(model_path):
                        print(f"[ML] Missing {system} {target} model: {model_path}", flush=True)
                        continue

                    self.models[system][target] = joblib.load(model_path)
                    self.model_types[system][target] = model_kind
                    ok_count += 1
                    print(f"[ML] Loaded {system} {target} ({model_kind}): {model_path}", flush=True)

                self.system_ready[system] = ok_count == len(self.TARGETS)
                if self.system_ready[system]:
                    print(f"[ML] {system} model set ready", flush=True)
                else:
                    print(f"[ML] {system} model set incomplete ({ok_count}/{len(self.TARGETS)})", flush=True)
        except Exception as e:
            print(f"[ML] Error loading ML-MARCH24-FINAL models: {e}", flush=True)

    def _features_array(self, sensor_data):
        vals = [
            float(sensor_data.get("ave_ph", 6.5)),
            float(sensor_data.get("ave_do", 5.0)),
            float(sensor_data.get("ave_tds", 600.0)),
            float(sensor_data.get("ave_temp", 24.0)),
            float(sensor_data.get("ave_humidity", 60.0)),
        ]
        return np.array([vals], dtype=float)

    def predict(self, sensor_data, plant_id, plant_system, date_obj=None):
        # plant_id/date_obj are accepted for API compatibility, but models are sensor-only.
        system = self._normalize_system(plant_system)
        if not system or not self.system_ready.get(system, False):
            return {target: None for target in self.TARGETS}

        x_raw = self._features_array(sensor_data)
        preds = {}

        for target in self.TARGETS:
            model = self.models[system].get(target)
            model_kind = self.model_types[system].get(target)
            if model is None:
                preds[target] = None
                continue

            try:
                x_in = x_raw
                if model_kind == "SVR":
                    scaler = self.scalers.get(system)
                    if scaler is None:
                        raise RuntimeError(f"Missing scaler for {system} SVR target {target}")
                    x_in = scaler.transform(x_raw)

                p = model.predict(x_in)[0]
                preds[target] = float(max(0.0, p))
            except Exception as e:
                print(f"[ML] Error predicting {system}:{target}: {e}", flush=True)
                preds[target] = None

        return preds

    def is_available(self, plant_system=None):
        if plant_system is None:
            return any(self.system_ready.values())

        system = self._normalize_system(plant_system)
        return bool(system and self.system_ready.get(system, False))
