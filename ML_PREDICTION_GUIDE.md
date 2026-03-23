# ML Prediction Integration - Implementation Guide

## 🎯 Overview
Successfully integrated machine learning predictions into the SIBOLTECH dashboard. The system predicts 5 plant growth metrics (height, length, weight, leaves, branches) based on sensor data and plant metadata.

## 📁 Files Created/Modified

### New Files
1. **ml_predictor.py** - Core ML prediction module
   - Loads 5 pre-trained sklearn models (joblib format)
   - Provides `PlantGrowthPredictor` class for making predictions
   - Handles feature engineering (date features, cyclic encoding)
   - Models location: `ml_models/ml-rpi-deploy/STEP_BY_STEP/models/`

### Modified Files
1. **api.py** - Backend API
   - Added `/api/predict` endpoint (POST)
   - Fetches sensor readings for specified date
   - Returns predictions with optional error analysis

2. **index.html** - Frontend UI
   - Replaced old prediction tab with modern interface
   - Added date picker, plant selector, farming system selector
   - Added "Add Actual Values" modal for user input
   - Added results display section with sensor data, metrics table, charts

3. **index.css** - Styling
   - Added comprehensive CSS for prediction interface
   - Modal styling, form layouts, results tables, chart containers

4. **index.js** - Frontend Logic
   - Prediction form initialization and handling
   - Modal management for actual values
   - API integration and error handling
   - Chart.js integration for visualization

## 🔧 How It Works

### Data Flow
```
User Input (Date, Plant, System)
        ↓
[API] Fetch sensor readings for that date
        ↓
Load ML models (5 sklearn pipelines)
        ↓
Prepare features (sensor data + date features)
        ↓
Run predictions through pipelines
        ↓
Return predictions + optional comparison with actual values
        ↓
Frontend displays results with charts
```

### API Endpoint: `/api/predict`

**Request:**
```json
{
  "date": "2026-03-23",
  "plant_id": 1,
  "farming_system": "dwc",  // or "aeroponics"
  "actual_values": {  // Optional
    "height": 15.5,
    "length": 10.2,
    "weight": 120.3,
    "leaves": 45,
    "branches": 8
  }
}
```

**Response:**
```json
{
  "success": true,
  "date": "2026-03-23",
  "plant_id": 1,
  "farming_system": "dwc",
  "sensor_data_used": {
    "ave_ph": 6.5,
    "ave_do": 5.0,
    "ave_tds": 600.0,
    "ave_temp": 24.0,
    "ave_humidity": 60.0
  },
  "predictions": {
    "height": 26.72,
    "length": 48.64,
    "weight": 23.49,
    "leaves": 310.99,
    "branches": 41.87
  },
  "actual_values": null,
  "comparison": {  // Only if actual_values provided
    "height": {
      "actual": 15.5,
      "predicted": 26.72,
      "error": 11.22,
      "error_percent": 72.4
    }
    // ... other metrics
  }
}
```

## 🌱 Prediction Models

All models are trained with sklearn pipelines that include:
- **Preprocessing**: StandardScaler for numeric features, OneHotEncoder for categorical
- **Algorithms**: Trained with multiple models, best selected per metric:
  - height: ExtraTrees_500 (R² = 0.9959)
  - length: RandomForest_400 (R² = 0.9976)
  - weight: ExtraTrees_500 (R² = 0.9611)
  - leaves: RandomForest_400 (R² = 0.9776)
  - branches: ExtraTrees_500 (R² = 0.9096)

### Features Used
- **Sensor inputs**: pH, DO, TDS, Temperature, Humidity
- **Plant data**: Plant number (1-6)
- **Temporal features**: Day of year, day of week, week of year, month
- **Cyclic encoding**: Day-of-year sine/cosine for seasonality
- **System type**: Aeroponics or DWC

## 🎮 Frontend Usage

### Prediction Tab Flow

1. **Select Date** - Choose which day to predict for
2. **Select Plant** - Pick plant number (1-6)
3. **Select System** - Choose aeroponics or DWC
4. **(Optional) Add Actual Values** - Enter measured values if available
5. **Run Prediction** - Triggers API call
6. **View Results**:
   - Sensor data used (averages for that date)
   - Metrics table (actual vs predicted vs error)
   - Side-by-side bar charts for each metric

### UI Components

- **Input Form**: Date picker, plant selector, system selector
- **Modal**: For entering actual measurements
- **Results Card**: Shows sensor data used
- **Metrics Table**: Sortable, shows all comparisons
- **Charts**: 5 bar charts (one per metric) using Chart.js

## 📊 Example Usage

**Via API:**
```bash
curl -X POST http://localhost:5000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-03-23",
    "plant_id": 1,
    "farming_system": "dwc",
    "actual_values": {
      "height": 15.5,
      "length": 10.2,
      "weight": 120.3,
      "leaves": 45,
      "branches": 8
    }
  }'
```

**Via Web UI:**
1. Navigate to "Prediction" tab on dashboard
2. Fill in date, plant number, and system
3. (Optional) Click "Add Actual Values" and enter measurements
4. Click "Run Prediction"
5. View results with charts

## ⚙️ Configuration

### Environment Variables
- `DATABASE_URL` - Database connection (defaults to SQLite)
- Models automatically loaded from `ml_models/ml-rpi-deploy/STEP_BY_STEP/models/`

### Model Loading
- Models are lazy-loaded on first prediction request
- All 5 models must be present for full functionality
- Graceful fallback if models unavailable (returns 503 error)

## 🧪 Testing

Model predictions tested and working:
```
Input sensors: ph=6.5, do=5.0, tds=600, temp=24, humidity=60, plant_id=1, system=dwc
Output: height=26.72, length=48.64, weight=23.49, leaves=310.99, branches=41.87
```

## 🐛 Troubleshooting

**Models not loading?**
- Check that `ml_models/ml-rpi-deploy/STEP_BY_STEP/models/` exists
- Verify all 5 joblib files are present (height_best_model.joblib, etc.)
- Check API logs for specific loading errors

**No sensor data for a date?**
- API falls back to default sensor values (pH 6.5, DO 5.0, TDS 600, Temp 24, Humidity 60)
- Predictions will still run but use defaults

**Chart rendering issues?**
- Ensure Chart.js is loaded in index.html
- Check browser console for JavaScript errors
- Verify API is returning proper JSON

## 🚀 Next Steps

Possible enhancements:
1. Add historical prediction tracking (save predictions to DB)
2. Batch predictions for multiple dates
3. Model retraining endpoint with new data
4. Prediction confidence intervals
5. Sensor data visualization with predictions overlay
6. Export predictions to CSV

## 📝 Files Modified Summary

- **ml_predictor.py**: 200 lines (new)
- **api.py**: +150 lines (predict endpoint)
- **index.html**: -200, +100 lines (refactored prediction section)
- **index.css**: +450 lines (prediction styling)
- **index.js**: +260 lines (prediction logic)
- **ml_models/ml-rpi-deploy/**: Downloaded from GitHub (67MB models)

**Total**: 7 files modified, 1 new module created
