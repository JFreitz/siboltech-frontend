#!/bin/bash
# SIBOLTECH API Startup Script
# Starts Flask API server only (Firebase handles cloud sync)

cd "$(dirname "$0")"
mkdir -p logs

# Kill any existing API process
pkill -f "python api.py" 2>/dev/null
sleep 1

# Activate virtual environment
source ~/sensor-venv/bin/activate

echo "🚀 Starting SIBOLTECH API server..."
echo "   Firebase Sync handles cloud data"
echo ""

# Start Flask API in foreground (for systemd)
exec python api.py

