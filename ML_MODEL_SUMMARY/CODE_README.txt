CODE USAGE GUIDE
================================================================================

This folder contains Python scripts used for training, testing, and making 
predictions with the plant growth ML models.

FILES OVERVIEW
================================================================================

1. 01_train_models.py
   Purpose: Train all 5 model types on 70% training data
   What it does:
     - Loads training_data.csv
     - Tests Linear Regression, Ridge, Lasso, Random Forest, Gradient Boosting
     - Reports R², MAE, RMSE for each model
     - Identifies Random Forest as best performer
   Run: python 01_train_models.py
   Output: Console summary of model performance

2. 02_test_models.py
   Purpose: Test trained Random Forest models on unseen 30% test data
   What it does:
     - Loads full dataset and performs 70/30 split
     - Trains Random Forest on 70%
     - Tests on 30% (completely unseen)
     - Shows sample predictions with error percentages
     - Verifies generalization to unseen data
   Run: python 02_test_models.py
   Output: Accuracy metrics and sample predictions

3. 03_verify_no_leakage.py
   Purpose: Verify that test data is truly unseen (no data leakage)
   What it does:
     - Checks for overlapping indices between train/test
     - Verifies random distribution of dates and plants
     - Confirms no same records appear in both sets
     - Special verification for March 17 records
   Run: python 03_verify_no_leakage.py
   Output: Detailed verification report confirming data integrity

4. 04_feature_importance.py
   Purpose: Analyze which features contribute most to predictions
   What it does:
     - Trains Random Forest models
     - Extracts feature importance scores
     - Shows sensor importance vs plant ID importance
     - Calculates percentage contribution per feature
   Run: python 04_feature_importance.py
   Output: Feature importance rankings and insights

5. 05_predict_new_data.py
   Purpose: Make predictions on new sensor data
   What it does:
     - Provides PlantGrowthPredictor class for inference
     - Single prediction: input one sensor reading
     - Batch prediction: input multiple sensor readings
     - Can be imported as module for production use
   Run: python 05_predict_new_data.py (shows examples)
   Or: from 05_predict_new_data import PlantGrowthPredictor

6. 06_create_split.py
   Purpose: Create 70/30 train/test split from full dataset
   What it does:
     - Loads COMBINED_SENSOR_PLANT_DATA.csv
     - Performs random 70/30 split (random_state=42)
     - Saves training_data.csv and test_data.csv
     - Verifies split integrity
   Run: python 06_create_split.py
   Output: Creates training_data.csv and test_data.csv files

================================================================================
EXECUTION ORDER (FOR REPRODUCTION)
================================================================================

Step 1: Create the split
   python 06_create_split.py
   Output: training_data.csv, test_data.csv

Step 2: Train models
   python 01_train_models.py
   Output: Console report of model performance

Step 3: Test on unseen data
   python 02_test_models.py
   Output: Accuracy metrics on 30% test set

Step 4: Verify no data leakage
   python 03_verify_no_leakage.py
   Output: Verification report

Step 5: Analyze feature importance
   python 04_feature_importance.py
   Output: Feature importance rankings

Step 6: Make predictions
   python 05_predict_new_data.py
   Output: Example predictions demonstrated

================================================================================
DEPENDENCIES
================================================================================

Python 3.x with packages:
  - pandas (data manipulation)
  - numpy (numerical computing)
  - scikit-learn (machine learning)

Install with:
  pip install pandas numpy scikit-learn

================================================================================
KEY PARAMETERS
================================================================================

All scripts use consistent parameters:

Train/Test Split:
  - test_size = 0.30 (30% for testing)
  - random_state = 42 (reproducible randomization)

Random Forest Models:
  - n_estimators = 100 (100 trees)
  - random_state = 42 (reproducible)
  - n_jobs = -1 (use all CPU cores)

Scaling:
  - StandardScaler (zero mean, unit variance)
  - Fit on training data only
  - Applied to test data

Features (7 total):
  - Sensors (5): ave_ph, ave_do, ave_tds, ave_temp, ave_humidity
  - Engineered (2): plant_no, day_of_year

Targets (4):
  - height (cm)
  - weight (g)
  - leaves (count)
  - branches (count)

================================================================================
EXPECTED RESULTS
================================================================================

Training Accuracy (on 70% training data):
  - Height: R² = 0.9980
  - Weight: R² = 0.9954
  - Leaves: R² = 0.9975
  - Branches: R² = 0.9915

Test Accuracy (on 30% unseen data):
  - Height: R² = 0.9875
  - Weight: R² = 0.9528
  - Leaves: R² = 0.9634
  - Branches: R² = 0.9222

If your results differ significantly, check:
  1. Python/scikit-learn versions
  2. File paths (scripts assume parent directory has COMBINED_SENSOR_PLANT_DATA.csv)
  3. Random state seeding (currently fixed at 42)

================================================================================
MAKING PREDICTIONS
================================================================================

To use the trained models for predictions:

Option 1: Command line
   python 05_predict_new_data.py
   (Will show example predictions)

Option 2: Import as module
   from 05_predict_new_data import PlantGrowthPredictor
   
   predictor = PlantGrowthPredictor('training_data.csv')
   
   prediction = predictor.predict(
       ph=6.2,          # pH level
       do=3.8,          # Dissolved oxygen
       tds=600,         # Total dissolved solids
       temp=23.5,       # Temperature
       humidity=63.2,   # Humidity
       plant_id=1,      # Plant identifier
       day_of_year=75   # Day of year (optional)
   )
   
   print(prediction)
   # Output: {'height': 40.23, 'weight': 25.15, 'leaves': 185, 'branches': 42}

Option 3: Batch predictions
   import pandas as pd
   from 05_predict_new_data import PlantGrowthPredictor
   
   predictor = PlantGrowthPredictor('training_data.csv')
   
   df = pd.read_csv('new_sensor_data.csv')
   predictions = predictor.predict_batch(df)

================================================================================
TROUBLESHOOTING
================================================================================

Error: FileNotFoundError: training_data.csv
  Solution: Run 06_create_split.py first, or ensure CSV files exist

Error: FileNotFoundError: COMBINED_SENSOR_PLANT_DATA.csv
  Solution: This must be in parent directory (/home/username/Despro/)

Error: ModuleNotFoundError: No module named 'sklearn'
  Solution: pip install scikit-learn

Error: Different results on re-runs
  Solution: All scripts use random_state=42 for reproducibility
           If results differ, check Python/sklearn versions

Error: Memory issues with large batch predictions
  Solution: Reduce batch size or use loop instead of batch

================================================================================
PERFORMANCE TIPS
================================================================================

1. Use batch predictions for multiple records (faster than loop)
2. Load predictor once, reuse for multiple predictions
3. Random Forest uses n_jobs=-1 (parallel processing)
4. StandardScaler is fitted on training data (saves memory)

Example efficient workflow:
   predictor = PlantGrowthPredictor('training_data.csv')  # Load once
   
   for batch in batches:  # Process multiple batches
       results = predictor.predict_batch(batch)

================================================================================
PRODUCTION DEPLOYMENT
================================================================================

For production use:

1. Save trained models:
   import pickle
   with open('rf_height_model.pkl', 'wb') as f:
       pickle.dump(predictor.models['height'], f)

2. Save scaler:
   with open('scaler.pkl', 'wb') as f:
       pickle.dump(predictor.scaler, f)

3. Load in production:
   with open('rf_height_model.pkl', 'rb') as f:
       model = pickle.load(f)

4. Create API endpoint:
   from flask import Flask, request, jsonify
   app = Flask(__name__)
   
   @app.route('/predict', methods=['POST'])
   def predict():
       data = request.json
       prediction = predictor.predict(**data)
       return jsonify(prediction)

================================================================================
