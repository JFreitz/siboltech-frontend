// === SIBOLTECH Firebase Configuration ===
// Using Firebase Firestore for real-time sensor data
let RELAY_API_URL = window.location.origin + '/api';  // For local LAN access
let API_BASE_URL = window.location.origin + '/api';   // Alias for compatibility

// Check if we're on local network (RPi LAN)
function isLocalAccess() {
    const host = window.location.hostname;
    return host === 'localhost' ||
           host === '127.0.0.1' ||
           host.startsWith('192.168.') ||
           host.startsWith('10.') ||
           host.startsWith('172.');
}

// Check if we're on static hosting (Vercel, etc.) - API not available
function isStaticHosting() {
    const host = window.location.hostname;
    return host.includes('vercel.app') || 
           host.includes('netlify.app') || 
           host.includes('github.io') ||
           host.includes('pages.dev');
}

// Initialize - Firebase will handle data via the module in index.html
async function initializeAPIUrl() {
    if (isLocalAccess()) {
        RELAY_API_URL = window.location.origin + '/api';
        API_BASE_URL = RELAY_API_URL;
        console.log('Local access detected, API URL:', RELAY_API_URL);
    } else {
        console.log('Using Firebase for sensor data (no API URL needed)');
        // API calls will be skipped on static hosting
    }
}

// Firebase handles all data - no API settings needed

// Stub function for backward compatibility (does nothing now)
async function waitForAPIUrl() {
    // Firebase handles data, no waiting needed
    return Promise.resolve();
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeAPIUrl();
});

// === CALIBRATION MODE (Disables Actuators) ===
let calibrationModeActive = false;

async function toggleCalibrationMode() {
    const btn = document.getElementById('calModeBtn');
    const statusEl = document.getElementById('calModeStatus');
    const iconEl = document.getElementById('calModeIcon');
    
    if (!btn) return;
    
    const newMode = !calibrationModeActive;
    
    try {
        if (isStaticHosting() && window.firebaseDB) {
            // Use Firebase on Vercel
            const calModeRef = window.firebaseDoc(window.firebaseDB, 'settings', 'calibration_mode');
            await window.firebaseSetDoc(calModeRef, {
                enabled: newMode,
                source: 'dashboard',
                updated_at: new Date().toISOString()
            });
            calibrationModeActive = newMode;
            updateCalibrationModeUI();
            console.log('Calibration mode (Firebase):', calibrationModeActive ? 'ENABLED' : 'DISABLED');
        } else {
            const res = await fetch(`${RELAY_API_URL}/calibration-mode`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: newMode })
            });
            
            if (res.ok) {
                calibrationModeActive = newMode;
                updateCalibrationModeUI();
                console.log('Calibration mode:', calibrationModeActive ? 'ENABLED' : 'DISABLED');
            } else {
                console.error('Failed to set calibration mode');
            }
        }
    } catch (e) {
        console.error('Error toggling calibration mode:', e);
        calibrationModeActive = newMode;
        updateCalibrationModeUI();
    }
}

function updateCalibrationModeUI() {
    const btn = document.getElementById('calModeBtn');
    const statusEl = document.getElementById('calModeStatus');
    const iconEl = document.getElementById('calModeIcon');
    
    if (!btn || !statusEl || !iconEl) return;
    
    if (calibrationModeActive) {
        btn.classList.add('active');
        statusEl.textContent = 'ON';
        iconEl.textContent = '🔧';
    } else {
        btn.classList.remove('active');
        statusEl.textContent = 'OFF';
        iconEl.textContent = '⚡';
    }
}

async function fetchCalibrationMode() {
    if (isStaticHosting()) {
        // Listen for calibration mode from Firebase
        const waitForFirebase = () => {
            if (window.firebaseDB && window.firebaseDoc && window.firebaseOnSnapshot) {
                const calModeRef = window.firebaseDoc(window.firebaseDB, 'settings', 'calibration_mode');
                window.firebaseOnSnapshot(calModeRef, (docSnap) => {
                    if (docSnap.exists()) {
                        calibrationModeActive = docSnap.data().enabled || false;
                        updateCalibrationModeUI();
                    }
                });
            } else {
                setTimeout(waitForFirebase, 500);
            }
        };
        waitForFirebase();
        return;
    }
    
    try {
        const res = await fetch(`${RELAY_API_URL}/calibration-mode`);
        if (res.ok) {
            const data = await res.json();
            calibrationModeActive = data.enabled || false;
            updateCalibrationModeUI();
        }
    } catch (e) {
        console.log('Could not fetch calibration mode:', e);
    }
}

// Initialize calibration mode button
document.addEventListener('DOMContentLoaded', () => {
    const calModeBtn = document.getElementById('calModeBtn');
    if (calModeBtn) {
        calModeBtn.addEventListener('click', toggleCalibrationMode);
    }
    // Fetch initial state
    fetchCalibrationMode();
});

// Fetch real sensor data from API
let _lastDataTimestamp = 0;
async function fetchSensorData() {
    // Skip if using Firebase real-time (Firebase will push updates)
    if (window.firebaseListenerActive) return;
    
    // Skip API calls on static hosting - Firebase will handle it
    if (isStaticHosting()) return;
    
    try {
        const res = await fetch(`${RELAY_API_URL}/latest`);
        const data = await res.json();
        updateSensorDisplayFromData(data);
        _lastDataTimestamp = Date.now();
        updateConnectionStatus(true);
    } catch (e) {
        console.log('API fetch error:', e);
        // On error, show zeros
        showSensorError();
        updateConnectionStatus(false);
    }
}

// Update sensor display from data object (used by both API and Firebase)
function updateSensorDisplayFromData(data) {
    // API returns: { "ph": {"value": 6.5, "unit": "pH"}, "temperature_c": {...}, ... }
    // Update dashboard sensor values (default to 0 if no data)
    const phVal = (data.ph && data.ph.value !== undefined) ? parseFloat(data.ph.value).toFixed(2) : '0.00';
    const doVal = (data.do_mg_l && data.do_mg_l.value !== undefined) ? parseFloat(data.do_mg_l.value).toFixed(2) + ' mg/L' : '0.00 mg/L';
    const tempVal = (data.temperature_c && data.temperature_c.value !== undefined) ? parseFloat(data.temperature_c.value).toFixed(1) + ' °C' : '0.0 °C';
    const humVal = (data.humidity && data.humidity.value !== undefined) ? parseFloat(data.humidity.value).toFixed(1) + ' %' : '0.0 %';
    const tdsVal = (data.tds_ppm && data.tds_ppm.value !== undefined) ? parseFloat(data.tds_ppm.value).toFixed(0) + ' ppm' : '0 ppm';

    document.querySelectorAll('#val-ph, [data-sensor="ph"] .value').forEach(el => {
        if (el) el.textContent = phVal;
    });
    document.querySelectorAll('#val-do, [data-sensor="do"] .value').forEach(el => {
        if (el) el.textContent = doVal;
    });
    document.querySelectorAll('#val-temp, [data-sensor="temp"] .value').forEach(el => {
        if (el) el.textContent = tempVal;
    });
    document.querySelectorAll('#val-hum, [data-sensor="hum"] .value').forEach(el => {
        if (el) el.textContent = humVal;
    });
    document.querySelectorAll('#val-tds, [data-sensor="tds"] .value').forEach(el => {
        if (el) el.textContent = tdsVal;
    });
}

function showSensorError() {
    document.querySelectorAll('#val-ph, [data-sensor="ph"] .value').forEach(el => { if (el) el.textContent = '0.00'; });
    document.querySelectorAll('#val-do, [data-sensor="do"] .value').forEach(el => { if (el) el.textContent = '0.00 mg/L'; });
    document.querySelectorAll('#val-temp, [data-sensor="temp"] .value').forEach(el => { if (el) el.textContent = '0.0 °C'; });
    document.querySelectorAll('#val-hum, [data-sensor="hum"] .value').forEach(el => { if (el) el.textContent = '0.0 %'; });
    document.querySelectorAll('#val-tds, [data-sensor="tds"] .value').forEach(el => { if (el) el.textContent = '0 ppm'; });
}

// Initialize Firebase real-time listener
function initFirebaseListener() {
    if (!window.firebaseReady || !window.firebaseDB) {
        console.log('Firebase not ready, will retry...');
        return false;
    }
    
    try {
        const db = window.firebaseDB;
        const docRef = window.firebaseDoc(db, 'sensors', 'latest');
        
        window.firebaseOnSnapshot(docRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                console.log('📡 Firebase update received:', Object.keys(data).filter(k => !k.startsWith('_')).join(', '));
                updateSensorDisplayFromData(data);
                window.firebaseListenerActive = true;
                _lastDataTimestamp = Date.now();
                updateConnectionStatus(true);
            }
        }, (error) => {
            console.error('Firebase listener error:', error);
            window.firebaseListenerActive = false;
            updateConnectionStatus(false);
        });
        
        console.log('✅ Firebase real-time listener active');
        return true;
    } catch (e) {
        console.error('Failed to init Firebase listener:', e);
        return false;
    }
}

// Start Firebase listener when ready, fallback to polling
window.addEventListener('firebaseReady', () => {
    console.log('🔥 Firebase ready event received');
    setTimeout(() => {
        if (initFirebaseListener()) {
            console.log('Using Firebase real-time updates (no polling needed)');
        }
    }, 500);
});

// Start fetching sensor data (polling fallback)
// On Vercel/static hosting, always poll sensor data every 2s for real-time updates
if (isStaticHosting()) {
	setInterval(fetchSensorData, 2000);
	setTimeout(fetchSensorData, 200);
} else {
	// On local/LAN, poll every 1s (unless Firebase listener disables it)
	setInterval(fetchSensorData, 1000);
	setTimeout(fetchSensorData, 200);
}

// === Connection Status Indicator ===
function updateConnectionStatus(isConnected) {
    const el = document.getElementById('topbarTime');
    if (!el) return;
    el.classList.remove('connected', 'disconnected');
    el.classList.add(isConnected ? 'connected' : 'disconnected');
}

// Stale-data watchdog: if no data for 15s, mark disconnected
setInterval(() => {
    if (_lastDataTimestamp && (Date.now() - _lastDataTimestamp > 15000)) {
        updateConnectionStatus(false);
    }
}, 5000);

// --- Calibrate UI logic ---
(function initCalibrate() {
	const calTab = document.getElementById('calibrate');
	if (!calTab) return;

	// --- State Management ---
	const state = {
		ph: { mode: '1', currentPoint: 1, data: [] },
		do: { mode: '1', currentPoint: 1, data: [] },
		tds: { mode: '1', currentPoint: 1, data: [] }
	};

	// --- Configuration ---
	const sensorConfigs = {
		ph: {
			name: 'pH',
			toggleId: 'calibrationModeToggle',
			sections: ['calibrationModeSection', 'inputPanelSection', 'calibrationValuesSection'],
			containerId: 'inputsContainer',
			applyBtnId: 'applyInputs',
			outSlopeId: 'outSlope',
			outOffsetId: 'outOffset',
			displayIds: { buffer: 'displayBuffer', voltage: 'displayVoltage', temp: 'displayTemp' },
			inputLabel: 'Buffer Solution Value (pH)',
			inputClass: 'inputBuffer',
			unit: 'pH'
		},
		do: {
			name: 'DO',
			toggleId: 'calibrationModeToggleDO',
			sections: ['calibrationModeSectionDO', 'inputPanelSectionDO', 'calibrationValuesSectionDO'],
			containerId: 'inputsContainerDO',
			applyBtnId: 'applyInputsDO',
			outSlopeId: 'outSlopeDO',
			outOffsetId: 'outOffsetDO',
			inputLabel: 'DO Saturation (%)',
			inputClass: 'inputDOSaturation',
			unit: '%'
		},
		tds: {
			name: 'TDS',
			toggleId: 'calibrationModeToggleTDS',
			sections: ['calibrationModeSectionTDS', 'inputPanelSectionTDS', 'calibrationValuesSectionTDS'],
			containerId: 'inputsContainerTDS',
			applyBtnId: 'applyInputsTDS',
			outSlopeId: 'outSlopeTDS',
			outOffsetId: 'outOffsetTDS',
			inputLabel: 'Standard Solution (ppm)',
			inputClass: 'inputBuffer',
			unit: 'ppm'
		}
	};

	// --- UI Helpers ---
	const showValidationModal = (message) => {
		const modal = document.getElementById('calibrationValidationModal');
		const msgEl = document.getElementById('calibrationValidationMessage');
		if (modal && msgEl) {
			msgEl.textContent = message;
			modal.style.display = 'flex';
		}
	};

	const closeValidationModal = () => {
		const modal = document.getElementById('calibrationValidationModal');
		if (modal) modal.style.display = 'none';
	};

	// Setup validation modal listeners
	['calibrationValidationClose', 'calibrationValidationOk'].forEach(id => {
		const el = document.getElementById(id);
		if (el) el.addEventListener('click', closeValidationModal);
	});

	// --- Core Logic Functions ---
	function updateToggle(sensorType) {
		const config = sensorConfigs[sensorType];
		const toggle = document.getElementById(config.toggleId);
		const toggleText = document.querySelector(`.calibration-section[data-sensor-type="${sensorType}"] .toggle-text`) 
						  || (sensorType === 'ph' ? document.querySelector('.toggle-text') : null);

		if (!toggle) return;

		const sensorState = state[sensorType] || { mode: '1', currentPoint: 1, data: [] };
		const container = document.getElementById(config.containerId);
		if (!container) return;

		const applyBtnHtml = sensorState.mode === '1' ? '' : `<button class="btn btn-apply" id="${config.applyBtnId}">Apply</button>`;

		let specialInputHtml = '';
		if (sensorType === 'do') {
			const satValue = sensorState.mode === '2' ? '0' : '100';
			specialInputHtml = `
				<div class="input-group" style="background-color: transparent; border: none; padding: 0; margin:0; border-radius: 0px;">
					<div class="label" style="margin-top: 12px;">DO Saturation (%):</div>
					<div class="inputdosaturation" aria-label="DO saturation">${satValue}</div>
				</div>`;
		} else {
			specialInputHtml = `
				<div class="input-group">
					<div class="label">${config.inputLabel}:</div>
					<input type="number" class="${config.inputClass}" value="">
				</div>`;
		}

		container.innerHTML = `
			<div class="inputs-grid" data-point="1">
				<div class="point-label">Point 1:</div>
				${specialInputHtml}
				<div class="input-group">
					<div class="label">Measured Voltage (mV):</div>
					<input type="number" class="inputVoltage" value="">
				</div>
				<div class="input-group">
					<div class="label">Temperature (°C):</div>
					<input type="number" class="inputTemp" value="">
				</div>
				${applyBtnHtml}
			</div>
		`;

		if (toggleText) toggleText.textContent = (toggle.checked ? 'ON' : 'OFF');
	}

	function addInputRow(sensorType, pointNum) {
		const config = sensorConfigs[sensorType];
		const container = document.getElementById(config.containerId);
		if (!container) return;

		const newGrid = document.createElement('div');
		newGrid.className = 'inputs-grid';
		newGrid.setAttribute('data-point', pointNum);

		let specialInputHtml = '';
		if (sensorType === 'do') {
			specialInputHtml = `
				<div class="input-group" style="background-color: transparent; border: none; padding: 0; margin:0; border-radius: 0px;">
					<div class="label" style="margin-top: 12px;">DO Saturation (%):</div>
					<div class="inputdosaturation" aria-label="DO saturation">100</div>
				</div>`;
		} else {
			specialInputHtml = `
				<div class="input-group">
					<div class="label">${config.inputLabel}:</div>
					<input type="number" class="${config.inputClass}" value="">
				</div>`;
		}

		newGrid.innerHTML = `
			<div class="point-label">Point ${pointNum}:</div>
			${specialInputHtml}
			<div class="input-group">
				<div class="label">Measured Voltage (mV):</div>
				<input type="number" class="inputVoltage" value="">
			</div>
			<div class="input-group">
				<div class="label">Temperature (°C):</div>
				<input type="number" class="inputTemp" value="">
			</div>
			<button class="btn btn-apply" id="${config.applyBtnId}">Apply</button>
		`;
		container.appendChild(newGrid);
	}

	function calculateAndDisplay(sensorType) {
		const config = sensorConfigs[sensorType];
		const sensorState = state[sensorType];
		const data = sensorState.data;
		if (data.length === 0) return;

		let slope = 0, offset = 0;
		const lastPoint = data[data.length - 1];

		if (sensorState.mode === '1' || data.length === 1) {
			const val = sensorType === 'tds' ? lastPoint.standard : (sensorType === 'do' ? lastPoint.doSaturation : lastPoint.buffer);
			if (sensorType === 'tds') {
				slope = lastPoint.voltage ? (val / lastPoint.voltage) : 0;
			} else {
				slope = lastPoint.voltage && val ? (lastPoint.voltage / val) : 0;
			}
			offset = lastPoint.temp ? (lastPoint.temp / 10) : 0;
		} else if (data.length >= 2) {
			const p1 = data[0];
			const p2 = data[data.length - 1];
			const val1 = sensorType === 'do' ? p1.doSaturation : p1.buffer;
			const val2 = sensorType === 'do' ? p2.doSaturation : p2.buffer;
			
			const valDiff = val2 - val1;
			const voltDiff = p2.voltage - p1.voltage;
			slope = valDiff !== 0 ? (voltDiff / valDiff) : 0;
			
			const avgTemp = data.reduce((sum, p) => sum + p.temp, 0) / data.length;
			offset = avgTemp / 10;
		}

		const outSlope = document.getElementById(config.outSlopeId);
		const outOffset = document.getElementById(config.outOffsetId);
		if (outSlope) outSlope.textContent = Number.isFinite(slope) ? slope.toFixed(2) : '0.00';
		if (outOffset) outOffset.textContent = Number.isFinite(offset) ? offset.toFixed(2) : '0.00';

		// Update display values for all sensors (pH, DO, TDS)
		if (config.displayIds) {
			Object.entries(config.displayIds).forEach(([key, id]) => {
				const el = document.getElementById(id);
				if (el && lastPoint[key] !== undefined) {
					el.textContent = Number.isFinite(lastPoint[key]) ? lastPoint[key].toFixed(2) : '0.00';
				}
			});
		}
	}

	// --- Event Listeners Setup ---

	// Tab switching
	const tabBtns = calTab.querySelectorAll('.calibrate-tab-btn');
	const grids = calTab.querySelectorAll('.calibrate-grid[data-sensor-type]');
	const sections = calTab.querySelectorAll('.calibration-section[data-sensor-type]');

	tabBtns.forEach(btn => {
		btn.addEventListener('click', () => {
			tabBtns.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			const sensor = btn.getAttribute('data-sensor');
			
			grids.forEach(g => g.style.display = g.getAttribute('data-sensor-type') === sensor ? 'grid' : 'none');
			sections.forEach(s => s.style.display = s.getAttribute('data-sensor-type') === sensor ? 'block' : 'none');
			console.log('Switched to sensor:', sensor);
		});
	});

	// Date label
	const calDate = document.getElementById('calDate');
	if (calDate) {
		const now = new Date();
		const formatted = `${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${now.toLocaleDateString()}`;
		calDate.textContent = formatted;
		// also set DO and TDS calibration date labels if present
		const calDateDO = document.getElementById('calDateDO');
		if (calDateDO) calDateDO.textContent = formatted;
		const calDateTDS = document.getElementById('calDateTDS');
		if (calDateTDS) calDateTDS.textContent = formatted;
	}

	// Initialize sensors
	Object.keys(sensorConfigs).forEach(sensorType => {
		const config = sensorConfigs[sensorType];
		updateToggle(sensorType);

		// Mode buttons
		const modeBtns = calTab.querySelectorAll(`.calibration-section[data-sensor-type="${sensorType}"] .mode-btn`);
		modeBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				modeBtns.forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				state[sensorType].mode = btn.getAttribute('data-mode') || '1';
				resetInputs(sensorType);
				
				const applyBtn = document.getElementById(config.applyBtnId);
				if (applyBtn) applyBtn.style.display = state[sensorType].mode === '1' ? 'none' : 'inline-block';
			});
		});

		// Input container delegation (Apply/Edit)
		const container = document.getElementById(config.containerId);
		if (container) {
			container.addEventListener('click', (e) => {
				// ensure we get the button element even if an inner node was clicked
				const btn = e.target.closest && e.target.closest('button');
				const isApply = btn && (btn.classList.contains('btn-apply') || btn.id.includes('applyInputs'));
				if (!isApply) return;

				const grid = btn.closest('.inputs-grid');
				const pointNum = parseInt(grid.getAttribute('data-point'));
				const inputs = grid.querySelectorAll('input');

				// Target calibration inputs only
				const targetSel = `.${config.inputClass}, .inputVoltage, .inputTemp`;
				const targetInputs = grid.querySelectorAll(targetSel);

				// Determine current state: if target inputs are disabled => currently applied state
				const anyDisabled = Array.from(targetInputs).some(i => i.disabled);

				if (anyDisabled) {
					// Currently applied -> enable calibration inputs for editing
					targetInputs.forEach(i => i.disabled = false);
					// Hide calibration values section while editing
					const valSection = document.getElementById(config.sections[2]);
					if (valSection) valSection.style.display = 'none';
					// Keep button text as 'Apply'
				} else {
					// Currently editable -> Apply: validate, save, then disable calibration inputs
					let allFilled = true;
					targetInputs.forEach(i => { if (!i.value.trim()) allFilled = false; });

					if (!allFilled && state[sensorType].mode !== '1') {
						showValidationModal('Please fill in all values before applying.');
						return;
					}

					const dataPoint = { point: pointNum };
					inputs.forEach(i => {
						const field = i.classList.contains(config.inputClass) ? (sensorType === 'tds' ? 'standard' : 'buffer') :
									  i.classList.contains('inputVoltage') ? 'voltage' : 'temp';
						dataPoint[field] = parseFloat(i.value) || 0;
					});

					if (sensorType === 'do') {
						const satDiv = grid.querySelector('.inputdosaturation') || grid.querySelector('.inputDOSaturation');
						dataPoint.doSaturation = parseFloat(satDiv ? (satDiv.value || satDiv.textContent) : '100');
					}

					const existingIdx = state[sensorType].data.findIndex(d => d.point === pointNum);
					if (existingIdx >= 0) state[sensorType].data[existingIdx] = dataPoint;
					else state[sensorType].data.push(dataPoint);

					// disable only calibration fields
					targetInputs.forEach(i => i.disabled = true);

					// Show calibration values section only if all required points are completed
					const requiredPoints = parseInt(state[sensorType].mode);
					const completedPoints = state[sensorType].data.length;
					if (completedPoints >= requiredPoints) {
						const valSection = document.getElementById(config.sections[2]);
						if (valSection) valSection.style.setProperty('display', 'block', 'important');
					}
					const inputPanel = document.getElementById(config.sections[1]);
					if (inputPanel) inputPanel.style.setProperty('display', 'block', 'important');
				}
			});
		}

		// Calibrate button
		const calBtn = document.getElementById(`calibrateBtn${sensorType === 'ph' ? '' : sensorType.toUpperCase()}`);
		if (calBtn) {
			if (sensorType === 'do') calBtn.style.display = 'flex';
			calBtn.addEventListener('click', () => {
				const sensorState = state[sensorType];
				if (sensorState.mode === '1') {
					const grid = document.getElementById(config.containerId).querySelector('.inputs-grid[data-point="1"]');
					const inputs = grid.querySelectorAll('input');
					let allFilled = true;
					inputs.forEach(i => { if (!i.value.trim()) allFilled = false; });
					
					if (!allFilled) {
						showValidationModal('Please fill in all values before calibrating.');
						return;
					}

					const dataPoint = { point: 1 };
					inputs.forEach(i => {
						const field = i.classList.contains(config.inputClass) ? (sensorType === 'tds' ? 'standard' : 'buffer') :
									  i.classList.contains('inputVoltage') ? 'voltage' : 'temp';
						dataPoint[field] = parseFloat(i.value) || 0;
					});
					if (sensorType === 'do') dataPoint.doSaturation = 100;
					sensorState.data = [dataPoint];
				}

				if (sensorState.data.length === 0) {
					showValidationModal('Please apply values before calibrating.');
					return;
				}

				calculateAndDisplay(sensorType);

				// Add next point if needed
				const maxPoints = parseInt(sensorState.mode);
				if (sensorState.data.length < maxPoints) {
					sensorState.currentPoint++;
					addInputRow(sensorType, sensorState.currentPoint);
				} else {
					// Show calibration values section only when all points are completed
					const valSection = document.getElementById(config.sections[2]);
					if (valSection) valSection.style.setProperty('display', 'block', 'important');
				}
			});
		}

		// Clear button

		// --- Training tab switching (show/hide farming method cards) ---
		(function initTrainingTabs(){
			const training = document.getElementById('training');
			if (!training) return;

			const tabBtns = training.querySelectorAll('.calibrate-tab-btn');
			const aeroCard = training.querySelector('.aeroponics-params');
			const dwcCard = training.querySelector('.dwc-params');
			const tradCard = training.querySelector('.traditional-params');

			function showOnly(card) {
				[aeroCard, dwcCard, tradCard].forEach(c => {
					if (!c) return;
					c.style.display = (c === card) ? 'block' : 'none';
				});

				// Inline actions sit in the right column; show them only when DWC is visible
				const inlineActions = training.querySelector('.right-cards-container .inline-actions');
				if (inlineActions) inlineActions.style.display = (card === dwcCard) ? 'flex' : 'none';
			}

			tabBtns.forEach(btn => {
				btn.addEventListener('click', () => {
					tabBtns.forEach(b => b.classList.remove('active'));
					btn.classList.add('active');
					const sensor = btn.getAttribute('data-sensor');
					if (sensor === 'ph') showOnly(aeroCard);
					else if (sensor === 'do') showOnly(dwcCard);
					else if (sensor === 'tds') showOnly(tradCard);
				});
			});

			// Initialize: click the active button or first button to set initial visibility
			const initial = training.querySelector('.calibrate-tab-btn.active') || tabBtns[0];
			if (initial) initial.click();
		})();

		// --- Training section buttons (new `.training-tab-btn`) ---
		(function initTrainingTabButtons(){
			const training = document.getElementById('training');
			if (!training) return;

			const tabBtns = training.querySelectorAll('.training-tab-btn');
			if (!tabBtns.length) return;

			const leftContainer = training.querySelector('.left-cards-container');
			const rightContainer = training.querySelector('.right-cards-container');
			const aeroCard = training.querySelector('.aeroponics-params');
			const dwcCard = training.querySelector('.dwc-params');
			const tradCard = training.querySelector('.traditional-params');
			const inlineActions = leftContainer ? leftContainer.querySelector('.inline-actions') : null;

			function showAeroView(){
				if (leftContainer) leftContainer.style.display = 'block';
				if (rightContainer) rightContainer.style.display = 'none';
				if (aeroCard) aeroCard.style.display = 'block';
				if (tradCard) tradCard.style.display = 'none';
				if (dwcCard) dwcCard.style.display = 'none';
				if (inlineActions) inlineActions.style.display = 'none';
			}

			function showDwcView(){
				if (leftContainer) leftContainer.style.display = 'none';
				if (rightContainer) rightContainer.style.display = 'block';
				if (dwcCard) dwcCard.style.display = 'block';
				if (aeroCard) aeroCard.style.display = 'none';
				if (tradCard) tradCard.style.display = 'none';
				if (inlineActions) inlineActions.style.display = 'none';
			}

			function showTradView(){
				if (leftContainer) leftContainer.style.display = 'block';
				if (rightContainer) rightContainer.style.display = 'none';
				if (aeroCard) aeroCard.style.display = 'none';
				if (tradCard) tradCard.style.display = 'block';
				if (dwcCard) dwcCard.style.display = 'none';
				if (inlineActions) inlineActions.style.display = 'flex';
			}

			tabBtns.forEach(btn => {
				btn.addEventListener('click', () => {
					tabBtns.forEach(b => b.classList.remove('active'));
					btn.classList.add('active');
					const sensor = btn.getAttribute('data-sensor');
					if (sensor === 'training-aero') showAeroView();
					else if (sensor === 'training-dwc') showDwcView();
					else if (sensor === 'training-trad') showTradView();
				});
			});

			// Initialize view
			const initial = training.querySelector('.training-tab-btn.active') || tabBtns[0];
			if (initial) initial.click();
		})();
		const clearBtn = document.getElementById(`clearCal${sensorType === 'ph' ? '' : sensorType.toUpperCase()}`);
		if (clearBtn) {
			clearBtn.addEventListener('click', () => {
				const outSlope = document.getElementById(config.outSlopeId);
				const outOffset = document.getElementById(config.outOffsetId);
				if (outSlope) outSlope.textContent = '-';
				if (outOffset) outOffset.textContent = '-';
			});
		}
	});

	// Special handling for "Apply Calibration Values" buttons to update the final display
	['ph', 'do', 'tds'].forEach(sensorType => {
		const btn = document.getElementById(`applyCalValues${sensorType === 'ph' ? '' : sensorType.toUpperCase()}`);
		if (btn) {
			btn.addEventListener('click', () => {
				const config = sensorConfigs[sensorType];
				const sensorState = state[sensorType];
				const lastPoint = sensorState.data[sensorState.data.length - 1];
				if (!lastPoint) return;

				const slope = document.getElementById(config.outSlopeId)?.textContent || '-';
				const offset = document.getElementById(config.outOffsetId)?.textContent || '-';

				const displayArea = document.getElementById(sensorType === 'ph' ? 'calibrationValuesColumnPH' : 
									(sensorType === 'do' ? 'calibrationValuesRowDO' : 'calBufferTDS'));
				
				if (!displayArea) return;

				// Check if all required points are completed
				const requiredPoints = parseInt(sensorState.mode);
				const completedPoints = sensorState.data.length;
				const allPointsCompleted = completedPoints >= requiredPoints;

				// Only show confirmation modal if all points are completed
				if (allPointsCompleted) {
					// Show confirmation modal
					const confirmModal = document.getElementById('calibrationConfirmModal');
					if (confirmModal) {
						confirmModal.style.display = 'flex';
						
						// Handle confirmation
						const confirmBtn = document.getElementById('calibrationConfirmOk');
						const cancelBtn = document.getElementById('calibrationConfirmCancel');
						const closeBtn = document.getElementById('calibrationConfirmClose');
						
						const closeModal = () => {
							confirmModal.style.display = 'none';
						};
						
						const handleConfirm = () => {
							// Apply the calibration values
							applyCalibrationValues(sensorType, config, sensorState, lastPoint, slope, offset, displayArea);
							
							// Turn off calibration mode
							const toggle = document.getElementById(config.toggleId);
							const toggleText = document.querySelector(`.calibration-section[data-sensor-type="${sensorType}"] .toggle-text`);
							if (toggle) {
								toggle.checked = false;
								if (toggleText) toggleText.textContent = 'OFF';
								// Hide calibration sections
								config.sections.forEach(id => {
									const el = document.getElementById(id);
									if (el) el.style.display = 'none';
								});
							}
							
							closeModal();
							// Remove event listeners
							confirmBtn.removeEventListener('click', handleConfirm);
							cancelBtn.removeEventListener('click', closeModal);
							closeBtn.removeEventListener('click', closeModal);
						};
						
						confirmBtn.addEventListener('click', handleConfirm);
						cancelBtn.addEventListener('click', closeModal);
						closeBtn.addEventListener('click', closeModal);
						return;
					}
				}

			});
		}
	});

	// Function to apply calibration values
	function applyCalibrationValues(sensorType, config, sensorState, lastPoint, slope, offset, displayArea) {
		if (sensorType === 'tds') {
			// TDS has specific IDs for display
			const ids = { standard: 'calBufferTDS', voltage: 'calVoltageTDS', temp: 'calTempTDS', slope: 'calSlopeTDS', offset: 'calOffsetValTDS' };
			if (document.getElementById(ids.standard)) document.getElementById(ids.standard).textContent = lastPoint.standard.toFixed(2);
			if (document.getElementById(ids.voltage)) document.getElementById(ids.voltage).textContent = lastPoint.voltage.toFixed(2);
			if (document.getElementById(ids.temp)) document.getElementById(ids.temp).textContent = lastPoint.temp.toFixed(2);
			if (document.getElementById(ids.slope)) document.getElementById(ids.slope).textContent = slope;
			if (document.getElementById(ids.offset)) document.getElementById(ids.offset).textContent = offset;
		} else {
			displayArea.removeAttribute('data-has-entries');
			displayArea.classList.remove('cal-values-stack');
			
			let html = '';
			const pointsToDisplay = sensorState.mode === '1' ? [lastPoint] : sensorState.data;
		
			pointsToDisplay.forEach((p, i) => {
				const valLabel = sensorType === 'ph' ? 'Buffer (pH)' : 'DO Saturation (%)';
				const val = sensorType === 'ph' ? p.buffer.toFixed(2) : p.doSaturation;

				// Compute per-point slope/offset so earlier points keep their values
				let pointSlope = '-';
				let pointOffset = '-';
				if (sensorState.mode === '1') {
					pointSlope = slope;
					pointOffset = offset;
				} else {
					if (i === 0) {
						const denom = sensorType === 'ph' ? p.buffer : p.doSaturation;
						const rawSlope = denom ? (p.voltage / denom) : 0;
						pointSlope = Number.isFinite(rawSlope) ? rawSlope.toFixed(2) : '-';
						const rawOffset = p.temp ? (p.temp / 10) : 0;
						pointOffset = Number.isFinite(rawOffset) ? rawOffset.toFixed(2) : '-';
					} else {
						const first = sensorState.data[0];
						const denom = sensorType === 'ph' ? (p.buffer - first.buffer) : (p.doSaturation - first.doSaturation);
						const rawSlope = denom ? ((p.voltage - first.voltage) / denom) : 0;
						pointSlope = Number.isFinite(rawSlope) ? rawSlope.toFixed(2) : '-';
						const avgTemp = (first.temp + p.temp) / 2;
						const rawOffset = avgTemp ? (avgTemp / 10) : 0;
						pointOffset = Number.isFinite(rawOffset) ? rawOffset.toFixed(2) : '-';
					}
				}

				html += `
					<div class="cal-value"><div class="label">${valLabel}</div><div class="value">${val}</div></div>
					<div class="cal-value"><div class="label">Voltage (mV)</div><div class="value">${p.voltage.toFixed(2)}</div></div>
					<div class="cal-value"><div class="label">Temperature (°C)</div><div class="value">${p.temp.toFixed(2)}</div></div>
					<div class="cal-value"><div class="label">Slope</div><div class="value">${pointSlope}</div></div>
					<div class="cal-value"><div class="label">Offset</div><div class="value">${pointOffset}</div></div>
				`;
			});
			displayArea.innerHTML = html;
		}
	}

})(); // End of initCalibrate function

document.addEventListener('DOMContentLoaded', ()=>{
	const burger = document.getElementById('burger');
	const sidebar = document.getElementById('sidebar');
	const tabs = document.querySelectorAll('[data-tab]');
	const contents = document.querySelectorAll('.tab-content');
	const logoutModal = document.getElementById('logoutModal');
	const logoutCancel = document.getElementById('logoutCancel');
	const logoutConfirm = document.getElementById('logoutConfirm');

	// Logout handler - special click handler just for logout
	const logoutTab = document.querySelector('[data-tab="logout"]');
	if(logoutTab) {
		logoutTab.addEventListener('click', (e)=>{
			e.preventDefault();
			e.stopPropagation();
			// Show logout confirmation modal
			logoutModal.style.display = 'flex';
		});
	}

	// Cancel logout
	if(logoutCancel) {
		logoutCancel.addEventListener('click', () => {
			logoutModal.style.display = 'none';
		});
	}

	// Confirm logout
	if(logoutConfirm) {
		logoutConfirm.addEventListener('click', () => {
			// Clear localStorage
			localStorage.removeItem('siboltech_user');
			// Redirect to login
			window.location.href = 'login.html';
		});
	}

	

	// Toggle sidebar (collapse/expand on desktop, open/close on mobile)
	burger.addEventListener('click', ()=>{
		// For mobile (small screens), use 'open' class for slide in/out
		if(window.innerWidth <= 900){
			sidebar.classList.toggle('open');
		} else {
			// For desktop, use 'collapsed' class for collapse/expand
			sidebar.classList.toggle('collapsed');
			// Add/remove body class for global styling adjustments
			document.body.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
			
			// Close dropdown menu when sidebar is collapsed
			if(sidebar.classList.contains('collapsed')) {
				const predictionItem = document.querySelector('.sidebar-dropdown');
				if(predictionItem) {
					predictionItem.classList.remove('open');
				}
			}
		}
	});

	// Tab switching - exclude logout tab
	tabs.forEach(a=>{
		// Skip logout tab as it has its own handler
		if(a.getAttribute('data-tab') === 'logout') return;
		
		a.addEventListener('click', (e)=>{
			e.preventDefault();
			const t = a.getAttribute('data-tab');
			
			// Special handling for prediction tab - toggle dropdown
			const predictionItem = document.querySelector('.sidebar-dropdown');
			const historyItem = document.querySelector('.sidebar-dropdown1');
			
			if(t === 'predicting') {
				if(predictionItem) {
					const isOpen = predictionItem.classList.toggle('open');
					// Close history dropdown
					if(historyItem) historyItem.classList.remove('open');
					// If opening, automatically show height graphs
					if(isOpen) {
						document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));
						a.classList.add('active');
						contents.forEach(c=>c.classList.remove('active'));
						const target = document.getElementById(t);
						if(target) target.classList.add('active');
						// Auto-navigate to height metric with default farming method
						const selectedMethod = window.selectedFarmingMethod || 'aeroponics';
						generatePlantGraphs('height', selectedMethod);
						// Mark height as active
						document.querySelectorAll('.prediction-option').forEach(opt => opt.classList.remove('active'));
						document.querySelector('.prediction-option[data-metric="height"]')?.classList.add('active');
					}
				}
				return;
			}

			// Special handling for history tab - toggle dropdown
			if(t === 'history') {
				if(historyItem) {
					const isOpen = historyItem.classList.toggle('open');
					// Close prediction dropdown
					if(predictionItem) predictionItem.classList.remove('open');
					if(isOpen) {
						document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));
						a.classList.add('active');
						contents.forEach(c=>c.classList.remove('active'));
						const target = document.getElementById(t);
						if(target) target.classList.add('active');
						// mark first history subitem active
						document.querySelectorAll('.history').forEach(h => h.classList.remove('active'));
						document.querySelector('.history')?.classList.add('active');
					} else {
						// If dropdown is closed, switch to another tab instead
						document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));
						a.classList.add('active');
						contents.forEach(c=>c.classList.remove('active'));
						const target = document.getElementById(t);
						if(target) target.classList.add('active');
					}
				}
				return;
			}
			
			// Close prediction and history dropdowns when switching to other tabs
			if(predictionItem) predictionItem.classList.remove('open');
			if(historyItem) historyItem.classList.remove('open');
			
			document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));
			a.classList.add('active');
			contents.forEach(c=>c.classList.remove('active'));
			const target = document.getElementById(t);
			if(target) target.classList.add('active');
			
			// Show/hide prediction dropdown in sidebar
			const predMetricSelect = document.getElementById('predictionMetric');
			if(t === 'predicting' && predMetricSelect){
				predMetricSelect.style.display = 'block';
			} else if(predMetricSelect){
				predMetricSelect.style.display = 'none';
			}
			
			// Redraw comparison graph when switching to home tab
			if(t === 'home'){
				setTimeout(() => {
					drawComparisonGraph();
				}, 100);
			}
			
			// close mobile sidebar after selection
			if(window.innerWidth <= 900) sidebar.classList.remove('open');
			// If calibrate selected, focus first input
			if(t === 'calibrate'){
				setTimeout(()=>document.getElementById('calSensor')?.focus(),200);
			}
		});
	});

	// History board interactions (tabs, plant pills, frequency chips)
	const historyBoard = document.querySelector('.history-board');
	if (historyBoard) {
		const historyState = { method: 'aero', plant: '1', interval: 'Daily', activeView: 'plant' };
		const historyEmptyCell = historyBoard.querySelector('.history-empty');

		const updateHistoryEmpty = () => {
			if (!historyEmptyCell) return;
			const methodLabel = historyBoard.querySelector('[data-history-tab].active')?.textContent?.trim() || 'Aeroponics';
			const intervalLabel = historyBoard.querySelector('.history-chip.active')?.textContent?.trim() || 'Daily';
			const plantLabel = historyBoard.querySelector('.history-pill.active')?.textContent?.trim() || '1';
			historyEmptyCell.textContent = `No data yet for Plant ${plantLabel} (${intervalLabel}, ${methodLabel}).`;
		};

		// Sidebar history menu (Plant / Actuator) click handlers
		const sidebarHistoryItems = document.querySelectorAll('#historyMenu .history');
		if(sidebarHistoryItems && sidebarHistoryItems.length) {
			sidebarHistoryItems.forEach(item => {
				item.addEventListener('click', (e) => {
					const metric = item.getAttribute('data-metric');
					if (metric === 'Plantbtn') {
						historyState.activeView = 'plant';
						// Show farming system tabs, plant filters and table, hide actuator
						document.getElementById('historyTabs').style.display = '';
						document.getElementById('plantHistoryFilters').style.display = '';
						document.getElementById('actuatorHistoryFilters').style.display = 'none';
						document.getElementById('plantHistoryView').style.display = '';
						document.getElementById('actuatorHistoryView').style.display = 'none';
						setTimeout(() => fetchHistoryData(), 50);
					} else if (metric === 'Actuatorbtn') {
						historyState.activeView = 'actuator';
						// Hide farming system tabs, plant filters, show actuator filters and table
						document.getElementById('historyTabs').style.display = 'none';
						document.getElementById('plantHistoryFilters').style.display = 'none';
						document.getElementById('actuatorHistoryFilters').style.display = '';
						document.getElementById('plantHistoryView').style.display = 'none';
						document.getElementById('actuatorHistoryView').style.display = '';
						setTimeout(() => fetchHistoryData(), 50);
					}
				});
			});
		}

		historyBoard.querySelectorAll('[data-history-tab]').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				historyBoard.querySelectorAll('[data-history-tab]').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				historyState.method = btn.getAttribute('data-history-tab') || historyState.method;
				updateHistoryEmpty();
				// Fetch history data immediately after switching farming system
				setTimeout(() => fetchHistoryData(), 50);
			});
		});

		// Initialize view visibility - show plant table, hide actuator by default
		historyBoard.querySelectorAll('.history-table-wrap').forEach(w => {
			if (w.getAttribute('data-history-view') === 'plant') {
				w.style.display = '';  // Show plant table
			} else {
				w.style.display = 'none';  // Hide actuator table initially
			}
		});

		historyBoard.querySelectorAll('.history-pill').forEach(pill => {
			pill.addEventListener('click', () => {
				historyBoard.querySelectorAll('.history-pill').forEach(p => p.classList.remove('active'));
				pill.classList.add('active');
				historyState.plant = pill.textContent.trim();
				updateHistoryEmpty();
				// Fetch updated history data
				setTimeout(() => fetchHistoryData(), 50);
			});
		});

		historyBoard.querySelectorAll('.history-chip').forEach(chip => {
			chip.addEventListener('click', () => {
				const parent = chip.parentElement;
				parent.querySelectorAll('.history-chip').forEach(c => c.classList.remove('active'));
				chip.classList.add('active');
				historyState.interval = chip.textContent.trim();
				updateHistoryEmpty();
				// Fetch updated history data
				setTimeout(() => fetchHistoryData(), 50);
			});
		});

		updateHistoryEmpty();

		// Fetch and populate history data
		const fetchHistoryData = async () => {
			const method = historyState.method; // 'aero', 'dwc', 'trad'
			const plant = historyState.plant;
			
			// Convert method code to farming system name
			let farmingSystem;
			if (method === 'aero') farmingSystem = 'aeroponics';
			else if (method === 'dwc') farmingSystem = 'dwc';
			else farmingSystem = 'traditional';
			
			const plantTableWrap = historyBoard.querySelector('[data-history-view="plant"]');
			const actuatorTableWrap = historyBoard.querySelector('[data-history-view="actuator"]');
			
			// Use Firebase on static hosting (Vercel)
			if (isStaticHosting() && window.loadPlantHistory) {
				// Normalize interval for bucketing
				let interval = historyState.interval.toLowerCase();
				if (interval === '15-min') interval = '15min';

				// Helper: bucket a Date to either daily or 15-min key
				const bucketKey = (d) => {
					if (!(d instanceof Date)) d = new Date(d);
					if (interval === '15min') {
						const m = Math.floor(d.getMinutes() / 15) * 15;
						return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
					}
					return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
				};

				try {
					// --- PLANT HISTORY ---
					if (plantTableWrap) {
						// Load sensor history from Firebase
						const sensorReadings = window.loadSensorHistory ? await window.loadSensorHistory(500) : [];
						const plantReadings = await window.loadPlantHistory(farmingSystem, 200);

						// Bucket sensor readings
						const sensorBuckets = {};
						(sensorReadings || []).forEach(r => {
							const ts = r.timestamp?.toDate?.() || (typeof r.timestamp === 'string' ? new Date(r.timestamp) : null);
							if (!ts) return;
							const bk = bucketKey(ts);
							if (!sensorBuckets[bk]) sensorBuckets[bk] = { ph: [], do: [], tds: [], temperature: [], humidity: [], timestamp: ts };
							const rd = r.readings || r;
							if (rd.ph?.value != null) sensorBuckets[bk].ph.push(rd.ph.value);
							if (rd.do_mg_l?.value != null) sensorBuckets[bk].do.push(rd.do_mg_l.value);
							if (rd.tds_ppm?.value != null) sensorBuckets[bk].tds.push(rd.tds_ppm.value);
							if (rd.temperature_c?.value != null) sensorBuckets[bk].temperature.push(rd.temperature_c.value);
							if (rd.humidity?.value != null) sensorBuckets[bk].humidity.push(rd.humidity.value);
						});

						// Bucket plant readings
						const plantBuckets = {};
						(plantReadings || []).forEach(r => {
							const ts = r.created_at?.toDate?.() || new Date(r.created_at);
							if (!ts) return;
							const bk = bucketKey(ts);
							if (!plantBuckets[bk]) plantBuckets[bk] = r;
						});

						// Merge into rows
						const allKeys = [...new Set([...Object.keys(sensorBuckets), ...Object.keys(plantBuckets)])].sort().reverse();
						const plantData = { readings: allKeys.slice(0, 100).map(bk => {
							const sb = sensorBuckets[bk] || {};
							const pb = plantBuckets[bk];
							const avg = (arr) => arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
							return {
								timestamp: sb.timestamp || (pb ? (pb.created_at?.toDate?.() || new Date(pb.created_at)) : bk),
								ph: avg(sb.ph),
								do: avg(sb.do),
								tds: avg(sb.tds),
								temperature: avg(sb.temperature),
								humidity: avg(sb.humidity),
								leaves: pb?.leaves || null,
								branches: pb?.branches || null,
								weight: pb?.weight || null,
								length: pb?.length || null,
								height: pb?.height || null,
							};
						})};
						populatePlantHistoryTable(plantTableWrap, plantData);
					}
					
					// --- ACTUATOR HISTORY ---
					if (actuatorTableWrap) {
						const actuatorEvents = window.loadActuatorHistory ? await window.loadActuatorHistory(500) : [];
						const sensorReadings2 = window.loadSensorHistory ? await window.loadSensorHistory(500) : [];

						// Bucket actuator events
						const actBuckets = {};
						(actuatorEvents || []).forEach(evt => {
							const ts = evt.timestamp?.toDate?.() || new Date(evt.timestamp);
							if (!ts || isNaN(ts)) return;
							const bk = bucketKey(ts);
							if (!actBuckets[bk]) actBuckets[bk] = { relay_events: {}, ph: [], do: [], tds: [], temperature: [], humidity: [], timestamp: ts };
							// Keep latest state per relay in bucket
							actBuckets[bk].relay_events[evt.relay_id] = evt.state;
						});

						// Add sensor data to actuator buckets
						(sensorReadings2 || []).forEach(r => {
							const ts = r.timestamp?.toDate?.() || (typeof r.timestamp === 'string' ? new Date(r.timestamp) : null);
							if (!ts) return;
							const bk = bucketKey(ts);
							if (!actBuckets[bk]) return; // Only add sensors to buckets that have actuator events
							const rd = r.readings || r;
							if (rd.ph?.value != null) actBuckets[bk].ph.push(rd.ph.value);
							if (rd.do_mg_l?.value != null) actBuckets[bk].do.push(rd.do_mg_l.value);
							if (rd.tds_ppm?.value != null) actBuckets[bk].tds.push(rd.tds_ppm.value);
							if (rd.temperature_c?.value != null) actBuckets[bk].temperature.push(rd.temperature_c.value);
							if (rd.humidity?.value != null) actBuckets[bk].humidity.push(rd.humidity.value);
						});

						// Build readings array
						const actKeys = Object.keys(actBuckets).sort().reverse();
						const actuatorData = { readings: actKeys.slice(0, 100).map(bk => {
							const b = actBuckets[bk];
							const avg = (arr) => arr && arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : null;
							return {
								timestamp: b.timestamp,
								relay_events: Object.entries(b.relay_events).map(([rid, st]) => ({ relay_id: parseInt(rid), state: st })),
								ph: avg(b.ph),
								do: avg(b.do),
								tds: avg(b.tds),
								temperature: avg(b.temperature),
								humidity: avg(b.humidity),
							};
						})};
						populateActuatorHistoryTable(actuatorTableWrap, actuatorData);
					}
				} catch (error) {
					console.error('Error fetching history from Firebase:', error);
				}
				return;
			}
			
			// Use API when available (local)
			await waitForAPIUrl();
			
			// Normalize interval: "Daily" -> "daily", "15-min" -> "15min"
			let interval = historyState.interval.toLowerCase();
			if (interval === '15-min') interval = '15min';
			
			try {
				// Fetch plant/sensor readings
				if (plantTableWrap) {
					// First try to get plant readings with sensor snapshots
					const plantRes = await fetch(`${RELAY_API_URL}/history?type=plant&plant_id=${plant}&interval=${interval}&farming_system=${farmingSystem}`);
					let plantData = plantRes.ok ? await plantRes.json() : { readings: [] };
					
					// If no plant readings, fetch sensor-only history instead
					if (!plantData.readings || plantData.readings.length === 0) {
						const sensorRes = await fetch(`${RELAY_API_URL}/history?type=sensor&interval=${interval}&limit=100`);
						if (sensorRes.ok) {
							const sensorData = await sensorRes.json();
							// Transform sensor data to plant table format (plant columns will be empty)
							plantData = {
								readings: (sensorData.readings || []).map(r => ({
									timestamp: r.timestamp,
									ph: r.ph,
									do: r.do,
									tds: r.tds,
									temperature: r.temperature,
									humidity: r.humidity,
									leaves: null,
									branches: null,
									weight: null,
									length: null,
									height: null
								}))
							};
						}
					}
					populatePlantHistoryTable(plantTableWrap, plantData);
				}
				
				// Fetch actuator events
				if (actuatorTableWrap) {
					const actuatorRes = await fetch(`${RELAY_API_URL}/history?type=actuator&plant_id=${plant}&interval=${interval}`);
					if (actuatorRes.ok) {
						const actuatorData = await actuatorRes.json();
						populateActuatorHistoryTable(actuatorTableWrap, actuatorData);
					}
				}
			} catch (error) {
				console.error('Error fetching history data:', error);
			}
		};
		
		const populatePlantHistoryTable = (tableWrap, data) => {
			const tbody = tableWrap.querySelector('tbody');
			if (!tbody) return;
			
			// API returns {readings: [...], success: true, ...}
			const readings = data.readings || data || [];
			
			if (!readings || readings.length === 0) {
				tbody.innerHTML = '<tr><td colspan="11" class="history-empty">No data available.</td></tr>';
				return;
			}

			// Hide sensor columns for traditional farming
			const method = historyState.method;
			const isTrad = method === 'trad';
			const thead = tableWrap.querySelector('thead');
			if (thead) {
				const sensorHeader = thead.querySelector('th[colspan="6"]');
				if (sensorHeader) {
					sensorHeader.style.display = isTrad ? 'none' : '';
				}
				// Hide only sensor columns (2-6: pH, DO, TDS, Temp, Humidity), keep timestamp
				const allCols = thead.querySelectorAll('.history-head-cols th');
				allCols.forEach((col, idx) => {
					if (idx >= 1 && idx <= 5) {  // Columns 2-6 are sensor columns (1-5 in 0-based indexing)
						col.style.display = isTrad ? 'none' : '';
					}
				});
			}
			
			const rows = readings.map(row => {
				const timestamp = new Date(row.timestamp).toLocaleString();
				const sensorDisplay = isTrad ? 'none' : '';
				const cells = [
					`<td>${timestamp}</td>`,
					`<td style="display: ${sensorDisplay}">${(row.ph !== null && row.ph !== undefined) ? row.ph.toFixed(2) : '-'}</td>`,
					`<td style="display: ${sensorDisplay}">${(row.do !== null && row.do !== undefined) ? row.do.toFixed(2) : '-'}</td>`,
					`<td style="display: ${sensorDisplay}">${(row.tds !== null && row.tds !== undefined) ? row.tds.toFixed(0) : '-'}</td>`,
					`<td style="display: ${sensorDisplay}">${(row.temperature !== null && row.temperature !== undefined) ? row.temperature.toFixed(1) : '-'}</td>`,
					`<td style="display: ${sensorDisplay}">${(row.humidity !== null && row.humidity !== undefined) ? row.humidity.toFixed(1) : '-'}</td>`,
					`<td>${(row.leaves !== null && row.leaves !== undefined) ? row.leaves.toFixed(1) : '-'}</td>`,
					`<td>${(row.branches !== null && row.branches !== undefined) ? row.branches.toFixed(1) : '-'}</td>`,
					`<td>${(row.weight !== null && row.weight !== undefined) ? row.weight.toFixed(1) : '-'}</td>`,
					`<td>${(row.length !== null && row.length !== undefined) ? row.length.toFixed(1) : '-'}</td>`,
					`<td>${(row.height !== null && row.height !== undefined) ? row.height.toFixed(1) : '-'}</td>`
				];
				return `<tr>${cells.join('')}</tr>`;
			}).join('');
			
			tbody.innerHTML = rows;
		};
		
		const populateActuatorHistoryTable = (tableWrap, data) => {
			const tbody = tableWrap.querySelector('tbody');
			if (!tbody) return;
			
			// API returns {readings: [...], success: true, ...}
			const readings = data.readings || data || [];
			
			if (!readings || readings.length === 0) {
				tbody.innerHTML = '<tr><td colspan="15" class="history-empty">No actuator events recorded.</td></tr>';
				return;
			}
			
			// Table column order matches HTML headers:
			// Misting(R4), Air Pump(R7), Exhaust IN(R9), Exhaust OUT(R5),
			// Lights Aero(R6), Lights DWC(R8), pH Up(R3), pH Down(R2), Leafy Green(R1)
			const columnOrder = [4, 7, 9, 5, 6, 8, 3, 2, 1];
			
			const rows = readings.map(row => {
				// Parse relay events into a map: relay_id -> state string
				const relayMap = {};
				if (row.relay_events && Array.isArray(row.relay_events)) {
					row.relay_events.forEach(evt => {
						relayMap[evt.relay_id] = evt.state === 1 ? 'ON' : 'OFF';
					});
				}
				
				// Build relay cells in correct column order
				const relayCells = columnOrder.map(rid => `<td>${relayMap[rid] || '-'}</td>`).join('');
				
				return `
					<tr>
						<td>${new Date(row.timestamp).toLocaleString()}</td>
						${relayCells}
						<td>${row.ph !== null && row.ph !== undefined ? row.ph.toFixed(2) : '-'}</td>
						<td>${row.do !== null && row.do !== undefined ? row.do.toFixed(2) : '-'}</td>
						<td>${row.tds !== null && row.tds !== undefined ? row.tds.toFixed(0) : '-'}</td>
						<td>${row.temperature !== null && row.temperature !== undefined ? row.temperature.toFixed(1) : '-'}</td>
						<td>${row.humidity !== null && row.humidity !== undefined ? row.humidity.toFixed(1) : '-'}</td>
					</tr>
				`;
			}).join('');
			
			tbody.innerHTML = rows;
		};
		
		// Fetch history data when tab/plant/interval changes
		historyBoard.addEventListener('click', () => {
			setTimeout(() => fetchHistoryData(), 100);
		});
		
		// Initial fetch when history tab opens
		const historyTab = document.querySelector('[data-tab="history"]');
		if (historyTab) {
			historyTab.addEventListener('click', () => {
				setTimeout(() => fetchHistoryData(), 100);
			});
		}
	}

	// ── Download ML Training CSV button ─────────────────────────
	(function initDownloadMLTraining(){
		const btn = document.getElementById('downloadMLTraining');
		if (!btn) return;

		btn.addEventListener('click', async () => {
			btn.disabled = true;
			btn.textContent = '⏳ Preparing…';

			try {
				if (isStaticHosting() && window.loadSensorHistory && window.loadPlantHistory) {
					// Firebase path: build CSV client-side from Firebase data
					const sensorData = await window.loadSensorHistory(10000);
					const plantAero = await window.loadPlantHistory('aeroponics', 5000);
					const plantDwc = await window.loadPlantHistory('dwc', 5000);
					const allPlant = [...(plantAero || []), ...(plantDwc || [])];

					const headers = [
						'timestamp', 'day', 'farming_system',
						'ave_ph', 'ave_do', 'ave_tds', 'ave_temp', 'ave_humidity',
						'Leaves', 'Branches', 'Weight', 'Length', 'Height'
					];

					// Group sensor data into 15-min buckets
					const sensorBuckets = {};
					if (sensorData && sensorData.length) {
						sensorData.forEach(s => {
							const ts = s.timestamp || '';
							if (!ts) return;
							// Bucket: YYYY-MM-DD HH:MM (round down to 15)
							const dt = new Date(ts);
							const min15 = Math.floor(dt.getMinutes() / 15) * 15;
							const bucket = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${min15}`;
							if (!sensorBuckets[bucket]) sensorBuckets[bucket] = { ph: [], do: [], tds: [], temp: [], hum: [] };
							if (s.ph !== undefined) sensorBuckets[bucket].ph.push(s.ph);
							if (s.do !== undefined) sensorBuckets[bucket].do.push(s.do);
							if (s.tds !== undefined) sensorBuckets[bucket].tds.push(s.tds);
							if (s.temperature !== undefined) sensorBuckets[bucket].temp.push(s.temperature);
							if (s.humidity !== undefined) sensorBuckets[bucket].hum.push(s.humidity);
						});
					}

					// Average helper
					const avg = arr => arr.length ? (arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(4) : '-';

					// Build plant lookup by bucket + system
					const plantLookup = {};
					allPlant.forEach(p => {
						const ts = p.timestamp || '';
						if (!ts) return;
						const dt = new Date(ts);
						const min15 = Math.floor(dt.getMinutes() / 15) * 15;
						const bucket = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${min15}`;
						const key = `${bucket}|${p.farming_system || 'aeroponics'}`;
						plantLookup[key] = p;
					});

					// Day numbering
					const allBuckets = Object.keys(sensorBuckets).sort();
					const firstDay = allBuckets.length ? allBuckets[0].substring(0, 10) : '';
					const dayNum = (bucket) => {
						const d1 = new Date(firstDay);
						const d2 = new Date(bucket.substring(0, 10));
						return Math.floor((d2 - d1) / 86400000) + 1;
					};

					const systems = ['aeroponics', 'dwc'];
					let csvContent = headers.join(',') + '\n';
					allBuckets.forEach(bucket => {
						const s = sensorBuckets[bucket];
						systems.forEach(fs => {
							const plant = plantLookup[`${bucket}|${fs}`] || {};
							const row = [
								bucket,
								dayNum(bucket),
								fs,
								avg(s.ph), avg(s.do), avg(s.tds), avg(s.temp), avg(s.hum),
								plant.leaves || plant.leaf_count || '-',
								plant.branches || plant.branch_count || '-',
								plant.weight || '-',
								plant.length || '-',
								plant.height || '-'
							];
							csvContent += row.join(',') + '\n';
						});
					});

					const blob = new Blob([csvContent], { type: 'text/csv' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `siboltech_ml_training_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
					a.click();
					URL.revokeObjectURL(url);
					showToast(`Exported ${allBuckets.length * 2} rows to ML Training CSV`, 'success');
				} else {
					// RPi API path
					await waitForAPIUrl();
					const a = document.createElement('a');
					a.href = `${RELAY_API_URL}/export-ml-training`;
					a.download = '';
					a.click();
					showToast('Downloading ML Training CSV…', 'success');
				}
			} catch (err) {
				console.error('[Download ML] Error:', err);
				showToast('Failed to export ML training data: ' + err.message, 'error');
			} finally {
				btn.disabled = false;
				btn.textContent = '⬇ ML Training CSV';
			}
		});
	})();

	// ── Download Sensor + Actuator CSV button ───────────────────
	(function initDownloadSensorActuator(){
		const btn = document.getElementById('downloadSensorActuator');
		if (!btn) return;

		btn.addEventListener('click', async () => {
			btn.disabled = true;
			btn.textContent = '⏳ Preparing…';

			try {
				if (isStaticHosting() && window.loadSensorHistory && window.loadActuatorHistory) {
					// Firebase path
					const sensorData = await window.loadSensorHistory(10000);
					const actuatorData = await window.loadActuatorHistory(10000);

					const relayLabels = {1:'Misting',2:'AirPump',3:'ExhaustIN',4:'ExhaustOUT',5:'LightsAero',6:'LightsDWC',7:'pHUp',8:'pHDown',9:'LeafyGreen'};
					const relayHeaders = [];
					for (let i = 1; i <= 9; i++) relayHeaders.push(`relay${i}_${relayLabels[i]}`);
					const headers = ['timestamp','ph','do_mg_l','tds_ppm','temperature_c','humidity'].concat(relayHeaders);

					// Group sensors into 15-min buckets
					const sensorBuckets = {};
					const allBuckets = [];
					if (sensorData && sensorData.length) {
						sensorData.forEach(s => {
							const ts = s.timestamp || '';
							if (!ts) return;
							const dt = new Date(ts);
							const min15 = Math.floor(dt.getMinutes() / 15) * 15;
							const bucket = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${min15}`;
							if (!sensorBuckets[bucket]) { sensorBuckets[bucket] = { ph:[], do:[], tds:[], temp:[], hum:[] }; allBuckets.push(bucket); }
							if (s.ph !== undefined) sensorBuckets[bucket].ph.push(s.ph);
							if (s.do !== undefined) sensorBuckets[bucket].do.push(s.do);
							if (s.tds !== undefined) sensorBuckets[bucket].tds.push(s.tds);
							if (s.temperature !== undefined) sensorBuckets[bucket].temp.push(s.temperature);
							if (s.humidity !== undefined) sensorBuckets[bucket].hum.push(s.humidity);
						});
					}
					const uniqueBuckets = [...new Set(allBuckets)].sort();
					const avg = arr => arr.length ? (arr.reduce((a,b) => a+b, 0) / arr.length).toFixed(4) : '';

					// Build relay state per bucket (carry-forward)
					const relayState = {};
					for (let i = 1; i <= 9; i++) relayState[i] = 'OFF';
					const relayEvents = [];
					if (actuatorData && actuatorData.length) {
						actuatorData.forEach(e => {
							const ts = e.timestamp || '';
							if (!ts) return;
							const dt = new Date(ts);
							const min15 = Math.floor(dt.getMinutes() / 15) * 15;
							const bucket = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${min15}`;
							relayEvents.push({ bucket, relay: e.relay_id, state: e.state ? 'ON' : 'OFF' });
						});
						relayEvents.sort((a,b) => a.bucket.localeCompare(b.bucket));
					}

					let evtIdx = 0;
					const relayByBucket = {};
					uniqueBuckets.forEach(bucket => {
						while (evtIdx < relayEvents.length && relayEvents[evtIdx].bucket <= bucket) {
							relayState[relayEvents[evtIdx].relay] = relayEvents[evtIdx].state;
							evtIdx++;
						}
						relayByBucket[bucket] = {...relayState};
					});

					let csvContent = headers.join(',') + '\n';
					uniqueBuckets.forEach(bucket => {
						const s = sensorBuckets[bucket] || { ph:[], do:[], tds:[], temp:[], hum:[] };
						const r = relayByBucket[bucket] || {};
						const row = [bucket, avg(s.ph), avg(s.do), avg(s.tds), avg(s.temp), avg(s.hum)];
						for (let i = 1; i <= 9; i++) row.push(r[i] || 'OFF');
						csvContent += row.join(',') + '\n';
					});

					const blob = new Blob([csvContent], { type: 'text/csv' });
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `siboltech_sensor_actuator_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.csv`;
					a.click();
					URL.revokeObjectURL(url);
					showToast(`Exported ${uniqueBuckets.length} rows to Sensor+Actuator CSV`, 'success');
				} else {
					// RPi API path
					await waitForAPIUrl();
					const a = document.createElement('a');
					a.href = `${RELAY_API_URL}/export-sensor-actuator`;
					a.download = '';
					a.click();
					showToast('Downloading Sensor+Actuator CSV…', 'success');
				}
			} catch (err) {
				console.error('[Download S+A] Error:', err);
				showToast('Failed to export sensor/actuator data: ' + err.message, 'error');
			} finally {
				btn.disabled = false;
				btn.textContent = '⬇ Sensor+Actuator CSV';
			}
		});
	})();

	// Prediction dropdown option click handlers
	document.querySelectorAll('.prediction-option').forEach(option => {
		option.addEventListener('click', (e) => {
			e.preventDefault();
			const metric = option.getAttribute('data-metric');
			// Update active state
			document.querySelectorAll('.prediction-option').forEach(opt => opt.classList.remove('active'));
			option.classList.add('active');
			
			// Generate graphs immediately with current farming method
			const selectedMethod = window.selectedFarmingMethod || 'aeroponics';
			generatePlantGraphs(metric, selectedMethod);
			
			// Close mobile sidebar if open
			if(window.innerWidth <= 900) sidebar.classList.remove('open');
		});
	});

	// Farming method selector button handlers
	document.querySelectorAll('.farming-method-btn').forEach(btn => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			const method = btn.getAttribute('data-method');
			// Update active state
			document.querySelectorAll('.farming-method-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			// Store selected farming method (used for graph generation)
			window.selectedFarmingMethod = method;
			// Show only the selected container
			document.querySelectorAll('.farming-method-container').forEach(container => {
				container.classList.remove('active');
			});
			const activeContainer = method === 'aeroponics' 
				? document.getElementById('aeroponicsContainer')
				: document.getElementById('dwcContainer');
			if(activeContainer) activeContainer.classList.add('active');
			// Get active metric from sidebar dropdown
			const activeMetricOption = document.querySelector('.prediction-option.active');
			const metric = activeMetricOption ? activeMetricOption.getAttribute('data-metric') : 'height';
			generatePlantGraphs(metric, method);
		});
	});

	// Aero-DWC Header Tab Buttons (same functionality)
	document.querySelectorAll('.aero-dwc-tab-btn').forEach(btn => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			const method = btn.getAttribute('data-sensor') === 'aeroponicssystem' ? 'aeroponics' : 'dwc';
			// Update active state
			document.querySelectorAll('.aero-dwc-tab-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			// Store selected farming method (used for graph generation)
			window.selectedFarmingMethod = method;
			// Show only the selected container
			document.querySelectorAll('.farming-method-container').forEach(container => {
				container.classList.remove('active');
			});
			const activeContainer = method === 'aeroponics' 
				? document.getElementById('aeroponicsContainer')
				: document.getElementById('dwcContainer');
			if(activeContainer) activeContainer.classList.add('active');
			// Get active metric from sidebar dropdown
			const activeMetricOption = document.querySelector('.prediction-option.active');
			const metric = activeMetricOption ? activeMetricOption.getAttribute('data-metric') : 'height';
			generatePlantGraphs(metric, method);
		});
	});

	// Metric button handlers in prediction section
	document.querySelectorAll('.metric-btn').forEach(btn => {
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			const metric = btn.getAttribute('data-metric');
			// Update active state
			document.querySelectorAll('.metric-btn').forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			// Generate graphs for selected metric with current farming method
			const selectedMethod = window.selectedFarmingMethod || 'aeroponics';
			generatePlantGraphs(metric, selectedMethod);
		});
	});

	// Show/hide sensor inputs depending on system
	const systemSelect = document.getElementById('systemSelect');
	const sensorParams = document.getElementById('sensorParams');
	function updateSystemUI(){
		const val = systemSelect.value;
		if(val === 'Traditional'){
			sensorParams.style.display = 'none';
		} else {
			sensorParams.style.display = 'block';
		}
	}
	if(systemSelect && sensorParams) {
		systemSelect.addEventListener('change', updateSystemUI);
		updateSystemUI();
	}


	// Home dashboard: draw mini graphs, populate sensor values
	// randomWalk function - accessible globally
	window.randomWalk = function(len, base=30, amp=10){
		const a=[]; let v=base; for(let i=0;i<len;i++){ v += (Math.random()-0.45)*amp; a.push(v); } return a;
	};

	// Live sensor time-series store (last 24 hours up to ~288 points at 5min)
	window.sensorSeries = {
		ph: [], do: [], tds: [], temp: [], hum: []
	};

	function recordSensorValue(sensor, value){
		const arr = window.sensorSeries[sensor];
		if(!arr) return;
		arr.push({ t: Date.now(), v: value });
		// Keep last 288 points (~24h if every 5 min). Trim older.
		if(arr.length > 288) arr.shift();
	}


	function drawMini(id){
		const c = document.getElementById(id); if(!c || !c.getContext) return;
		
		// Get container dimensions for responsive canvas
		const container = c.parentElement; // mini-canvas-wrapper
		if(!container) return;
		
		const containerRect = container.getBoundingClientRect();
		const containerWidth = containerRect.width;
		const containerHeight = containerRect.height;
		
		// Set canvas dimensions to match container
		c.width = containerWidth;
		c.height = containerHeight;
		
		const ctx = c.getContext('2d');
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		
		const w = c.width, h = c.height;
		ctx.clearRect(0, 0, w, h);
		// Background handled by wrapper
		
		const leftPad = Math.max(35, w * 0.15), rightPad = 8, topPad = 8, bottomPad = 8;
		
		// Determine base values based on sensor type
		let baseVal, unit, currentVal;
		if(id === 'mini1') { // DO
			baseVal = 7 + Math.random() * 2;
			unit = ' mg/L';
			currentVal = baseVal.toFixed(1);
		} else if(id === 'mini2') { // pH
			baseVal = 6 + Math.random() * 0.8;
			unit = ' pH';
			currentVal = baseVal.toFixed(2);
		} else { // Temperature
			baseVal = 24 + Math.random() * 3;
			unit = ' °C';
			currentVal = baseVal.toFixed(1);
		}
		
		// Update value display
		const valueEl = document.getElementById(id + '-value');
		if(valueEl) {
			valueEl.textContent = currentVal + unit;
		}
		
		const data = randomWalk(20, baseVal, baseVal * 0.15);
		const min = Math.min(...data);
		const max = Math.max(...data);
		const range = max - min || 1;

		// Draw smooth line with gradient fill
		const plotW = w - leftPad - rightPad;
		const plotH = h - topPad - bottomPad;
		
		// Draw horizontal grid lines and y-axis ticks
		const numTicks = 3;
		ctx.fillStyle = '#9aa4b8';
		ctx.font = '9px Poppins, Segoe UI, Arial, sans-serif';
		ctx.textAlign = 'right';
		
		for(let i = 0; i <= numTicks; i++) {
			const val = max - (i / numTicks) * (max - min);
			const y = topPad + (i / numTicks) * plotH;
			
			// Horizontal grid line (dashed, like growth prediction)
			ctx.strokeStyle = '#e8ecf4';
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.beginPath();
			ctx.moveTo(leftPad, y);
			ctx.lineTo(w - rightPad, y);
			ctx.stroke();
			ctx.setLineDash([]);
			
			// Y-axis label (show min and max values)
			if(i === 0 || i === numTicks) {
				ctx.fillText(val.toFixed(id === 'mini2' ? 2 : 1), leftPad - 8, y + 3);
			}
		}
		
		// Draw vertical grid lines (dashed, like growth prediction)
		ctx.strokeStyle = '#f0f4f8';
		ctx.lineWidth = 1;
		const verticalTicks = 4;
		for(let i = 0; i <= verticalTicks; i++) {
			const x = leftPad + (i / verticalTicks) * plotW;
			ctx.setLineDash([3, 3]);
			ctx.beginPath();
			ctx.moveTo(x, topPad);
			ctx.lineTo(x, h - bottomPad);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		
		// Create points for smooth curve
		const points = [];
		data.forEach((val, i) => {
			const x = leftPad + (i / (data.length - 1)) * plotW;
			const y = topPad + (1 - (val - min) / range) * plotH;
			points.push({x, y, val});
		});
		
		// Draw gradient fill
		ctx.beginPath();
		points.forEach((point, i) => {
			if(i === 0) ctx.moveTo(point.x, point.y);
			else {
				const prevPoint = points[i - 1];
				const cpX = (prevPoint.x + point.x) / 2;
				const cpY = (prevPoint.y + point.y) / 2;
				ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
			}
		});
		ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y,
			points[points.length - 1].x, points[points.length - 1].y);
		ctx.lineTo(points[points.length - 1].x, h - bottomPad);
		ctx.lineTo(points[0].x, h - bottomPad);
		ctx.closePath();
		
		const gradient = ctx.createLinearGradient(leftPad, topPad, leftPad, h - bottomPad);
		gradient.addColorStop(0, 'rgba(43, 110, 246, 0.15)');
		gradient.addColorStop(1, 'rgba(43, 110, 246, 0)');
		ctx.fillStyle = gradient;
		ctx.fill();
		
		// Draw smooth line
		ctx.beginPath();
		points.forEach((point, i) => {
			if(i === 0) ctx.moveTo(point.x, point.y);
			else {
				const prevPoint = points[i - 1];
				const cpX = (prevPoint.x + point.x) / 2;
				const cpY = (prevPoint.y + point.y) / 2;
				ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
			}
		});
		ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y,
			points[points.length - 1].x, points[points.length - 1].y);
		
		ctx.strokeStyle = '#2b6ef6';
		ctx.lineWidth = 2.5;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = 'rgba(43, 110, 246, 0.25)';
		ctx.shadowBlur = 4;
		ctx.stroke();
		ctx.shadowBlur = 0;
		
		// Draw small indicator at the end
		const lastPoint = points[points.length - 1];
		ctx.beginPath();
		ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
		ctx.fillStyle = '#ffffff';
		ctx.fill();
		ctx.strokeStyle = '#2b6ef6';
		ctx.lineWidth = 2;
		ctx.stroke();
	}

	// Threshold map for sensor statuses
	const sensorThresholds = {
		ph: {
			name: 'pH Level',
			unit: 'pH',
			ranges: {
				neutral: [[5.5, 6.5]], // Hydroponics optimal range
				normal: [[6.5, 8.5]], // General water acceptable range
				dangerous: [[-Infinity, 5.5], [8.5, Infinity]] // Too acidic or too alkaline
			}
		},
		do: {
			name: 'Dissolved Oxygen',
			unit: 'mg/L',
			ranges: {
				neutral: [[6.5, Infinity]], // Excellent: ≥ 6.5 mg/L
				normal: [[5.0, 6.5]], // Acceptable: 5.0 – 6.4 mg/L
				dangerous: [[-Infinity, 5.0]] // Low to Critical: < 5.0 mg/L
			}
		},
		temp: {
			name: 'Temperature',
			unit: '°C',
			ranges: {
				neutral: [[18, 28]], // Plants / Hydroponics ideal: 18 – 28°C
				normal: [[15, 18], [28, 30]], // Extended acceptable range
				dangerous: [[-Infinity, 15], [30, Infinity]] // Too cold or too hot
			}
		},
		hum: {
			name: 'Humidity',
			unit: '%',
			ranges: {
				neutral: [[50, 70]], // Plants general: 50 – 70%
				normal: [[40, 50], [70, 80]], // Extended acceptable range
				dangerous: [[-Infinity, 30], [80, Infinity]] // Too dry or too humid
			}
		},
		tds: {
			name: 'Total Dissolved Solids',
			unit: 'ppm',
			ranges: {
				neutral: [[600, 1000]], // Hydroponics vegetative stage
				normal: [[300, 600], [1000, 1400]], // Seedlings to flowering
				dangerous: [[-Infinity, 300], [1400, Infinity]] // Too low or too high
			}
		}
	};

	function formatRange(range, unit){
		const [min, max] = range;
		if(min === -Infinity) return `< ${max} ${unit}`;
		if(max === Infinity) return `> ${min} ${unit}`;
		return `${min} - ${max} ${unit}`;
	}

	function formatRangeList(ranges, unit){
		return ranges.map(r => formatRange(r, unit)).join(' or ');
	}

	const notificationCooldown = new Map();

	function isWithinRange(value, range){
		const [min, max] = range;
		return value >= min && value <= max;
	}

	function matchesRangeSet(value, ranges){
		return ranges.some(range => isWithinRange(value, range));
	}

	function getSensorStatus(sensorType, value){
		const thresholds = sensorThresholds[sensorType];
		const numValue = parseFloat(value);
		if(!thresholds || Number.isNaN(numValue)){
			return {status: 'Normal', statusClass: 'normal'};
		}

		if(matchesRangeSet(numValue, thresholds.ranges.dangerous)){
			return {status: 'Critical', statusClass: 'dangerous'};
		}

		if(matchesRangeSet(numValue, thresholds.ranges.neutral)){
			return {status: 'Normal', statusClass: 'neutral'};
		}

		if(matchesRangeSet(numValue, thresholds.ranges.normal)){
			return {status: 'Warning', statusClass: 'dangerous'};
		}

		return {status: 'Normal', statusClass: 'normal'};
	}

	function showNotification(sensorType, value, status, level){
		const container = document.getElementById('notificationContainer');
		if(!container) return;

		const key = `${sensorType}-${level}`;
		const now = Date.now();
		const lastTime = notificationCooldown.get(key) || 0;
		if(now - lastTime < 8000) return; // prevent spam every interval
		notificationCooldown.set(key, now);

		const notif = document.createElement('div');
		notif.className = `notification ${level}`;
		notif.innerHTML = `
			<div class="notification-icon">${level === 'dangerous' ? '⚠️' : 'ℹ️'}</div>
			<div class="notification-content">
				<div class="notification-title">${sensorThresholds[sensorType]?.name || sensorType}</div>
				<div class="notification-message">${status} reading: ${value}</div>
			</div>
		`;

		container.appendChild(notif);

		setTimeout(() => {
			notif.classList.add('show');
		}, 20);

		setTimeout(() => {
			notif.classList.remove('show');
			setTimeout(() => notif.remove(), 400);
		}, 6000);
	}

	// Threshold modal handling
	const thresholdModal = document.getElementById('thresholdModal');
	const thresholdClose = document.getElementById('thresholdClose');

	function showThresholdModal(sensorType){
		const data = sensorThresholds[sensorType];
		if(!data || !thresholdModal) return;

		document.getElementById('thresholdTitle').textContent = `${data.name} Thresholds`;
		document.getElementById('thresholdNeutral').textContent = formatRangeList(data.ranges.neutral, data.unit);
		document.getElementById('thresholdNormal').textContent = formatRangeList(data.ranges.normal, data.unit);
		document.getElementById('thresholdDangerous').textContent = formatRangeList(data.ranges.dangerous, data.unit);
		document.getElementById('thresholdUnit').textContent = `Unit: ${data.unit}`;

		thresholdModal.classList.add('show');
	}

	function hideThresholdModal(){
		if(!thresholdModal) return;
		thresholdModal.classList.remove('show');
	}

	if(thresholdClose){
		thresholdClose.addEventListener('click', hideThresholdModal);
	}

	if(thresholdModal){
		thresholdModal.addEventListener('click', (e)=>{
			if(e.target === thresholdModal) hideThresholdModal();
		});
	}

	document.addEventListener('keydown', (e)=>{
		if(e.key === 'Escape' && thresholdModal?.classList.contains('show')) hideThresholdModal();
	});

	document.querySelectorAll('.info-icon').forEach(icon => {
		icon.addEventListener('click', (e)=>{
			e.preventDefault();
			e.stopPropagation();
			const sensorType = icon.getAttribute('data-sensor');
			showThresholdModal(sensorType);
		});
	});

	// Fallback delegated handler to ensure clicks always open the modal
	document.addEventListener('click', (e)=>{
		const icon = e.target.closest('.info-icon');
		if(!icon) return;
		e.preventDefault();
		e.stopPropagation();
		const sensorType = icon.getAttribute('data-sensor');
		showThresholdModal(sensorType);
	}, true);

	// Helper function to update all sensor alerts (dashboard, training, etc.)
	function updateSensorAlert(sensorType, value){
		const {status, statusClass} = getSensorStatus(sensorType, value);
		document.querySelectorAll(`[id="alert-${sensorType}"]`).forEach(alertEl => {
			alertEl.textContent = status;
			alertEl.className = `alert ${statusClass}`;
		});

		// Only show notifications for critical (dangerous) values, not warning or optimal
		if(statusClass === 'dangerous'){
			showNotification(sensorType, value, status, statusClass);
		}
	}

	// Override starts ON (manual mode) - actuators won't go crazy on startup
	// When OFF (auto mode), actuators respond to sensor readings
	let actuatorOverride = true;

	// Mapping between dashboard actuator IDs and relay numbers
	const ACTUATOR_TO_RELAY = {
		'act-water': 4,        // Misting Pump
		'act-air': 7,          // Air Pump
		'act-fan-in': 9,       // Exhaust Fan (In)
		'act-fan-out': 5,      // Exhaust Fan (Out)
		'act-lights-aerponics': 6, // Grow Lights (Aeroponics)
		'act-lights-dwc': 8,   // Grow Lights (DWC)
		'btn-ph-up': 3,        // pH Up (nutrient)
		'btn-ph-down': 2,      // pH Down (nutrient)
		'btn-leafy-green': 1   // Leafy Green (nutrient)
	};

	const RELAY_TO_ACTUATOR = Object.fromEntries(
		Object.entries(ACTUATOR_TO_RELAY).map(([k, v]) => [v, k])
	);

	// Nutrient threshold configuration with hysteresis
	const NUTRIENT_THRESHOLDS = {
		'btn-ph-up': { 
			sensor: 'ph', 
			condition: 'below', 
			triggerOn: 5.5,
			triggerOff: 5.8,
			consecutiveRequired: 3
		},
		'btn-ph-down': { 
			sensor: 'ph', 
			condition: 'above', 
			triggerOn: 6.5,
			triggerOff: 6.2,
			consecutiveRequired: 3
		},
		'btn-leafy-green': { 
			sensor: 'tds', 
			condition: 'below', 
			triggerOn: 600,
			triggerOff: 650,
			consecutiveRequired: 3
		}
	};

	const NUTRIENT_PULSE_DURATION = 2000;
	const NUTRIENT_AUTO_COOLDOWN = 30000;
	const MOVING_AVG_WINDOW = 5;

	const nutrientLastActivation = { 'btn-ph-up': 0, 'btn-ph-down': 0, 'btn-leafy-green': 0 };
	const sensorHistory = { ph: [], tds: [] };
	const consecutiveBreaches = { 'btn-ph-up': 0, 'btn-ph-down': 0, 'btn-leafy-green': 0 };
	const nutrientActiveState = { 'btn-ph-up': false, 'btn-ph-down': false, 'btn-leafy-green': false };

	function updateMovingAverage(sensor, newValue) {
		const history = sensorHistory[sensor];
		if (!history) return newValue;
		history.push(newValue);
		if (history.length > MOVING_AVG_WINDOW) history.shift();
		return history.reduce((a, b) => a + b, 0) / history.length;
	}

	// Toggle relay via API or Firebase
	// RPi LAN API URL for direct relay control (even from Vercel, browser is on same LAN)
	const RPI_LAN_URL = 'http://192.168.100.72:5000/api';

	async function toggleRelay(relayNum, newState, stateEl) {
		const action = newState ? 'ON' : 'OFF';
		
		// On HTTPS/static hosting: use Firebase only (avoids mixed content errors)
		if (isStaticHosting() && window.sendRelayCommandFirebase) {
			const success = await window.sendRelayCommandFirebase(`R${relayNum}`, action);
			if (success) {
				if (stateEl) {
					stateEl.classList.remove('state-off', 'state-on');
					stateEl.classList.add(newState ? 'state-on' : 'state-off');
					stateEl.textContent = action;
				}
				const actuatorId = RELAY_TO_ACTUATOR[relayNum];
				if (actuatorId) syncActuatorUI(actuatorId, newState);
				console.log(`✅ Relay ${relayNum} ${action} via Firebase`);
			} else {
				console.error(`Firebase relay command failed for relay ${relayNum}`);
			}
			return;
		}
		
		// On LAN: try direct RPi API first (fastest, no quota issues)
		try {
			const url = isLocalAccess() ? `${RPI_LAN_URL}/relay/${relayNum}/${action.toLowerCase()}` : `${RELAY_API_URL}/relay/${relayNum}/${action.toLowerCase()}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: AbortSignal.timeout(3000)
			});
			if (response.ok) {
				if (stateEl) {
					stateEl.classList.remove('state-off', 'state-on');
					stateEl.classList.add(newState ? 'state-on' : 'state-off');
					stateEl.textContent = newState ? 'ON' : 'OFF';
				}
				const actuatorId = RELAY_TO_ACTUATOR[relayNum];
				if (actuatorId) syncActuatorUI(actuatorId, newState);
				console.log(`✅ Relay ${relayNum} ${action} via direct API`);
			}
		} catch (error) {
			console.error(`Error toggling relay ${relayNum}:`, error);
		}
	}

	function syncActuatorUI(actuatorId, state) {
		const checkbox = document.getElementById(actuatorId);
		if (!checkbox) return;
		checkbox.checked = state;
		const label = checkbox.closest('.toggle-switch');
		const toggleText = label ? label.querySelector('.toggle-text') : null;
		if (toggleText) toggleText.textContent = state ? 'ON' : 'OFF';
	}

	// Fetch relay status from API and sync all actuator UIs
	async function loadRelayStatus() {
		// On HTTPS/static hosting: Firebase onSnapshot handles relay status — skip HTTP
		if (isStaticHosting()) return;
		
		// On LAN: fetch directly from RPi API
		try {
			const url = `${RELAY_API_URL}/relay/status`;
			const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
			if (response.ok) {
				const data = await response.json();
				if (data.relays) {
					data.relays.forEach(relay => {
						const actuatorId = RELAY_TO_ACTUATOR[relay.id];
						if (actuatorId) {
							syncActuatorUI(actuatorId, relay.state);
						}
					});
				}
			}
		} catch (error) {
			// Silent fail - Firebase onSnapshot will handle it on Vercel
		}
	}

	// Turn all actuators/relays OFF
	async function turnAllActuatorsOff() {
		// On HTTPS/static hosting: use Firebase only (avoids mixed content)
		if (isStaticHosting() && window.sendRelayCommandFirebase) {
			for (let i = 1; i <= 9; i++) {
				await window.sendRelayCommandFirebase(`R${i}`, 'OFF');
			}
			Object.keys(ACTUATOR_TO_RELAY).forEach(actuatorId => {
				syncActuatorUI(actuatorId, false);
			});
			console.log('All actuators turned OFF via Firebase');
			return;
		}
		
		// On LAN: use direct RPi API (fastest, no quota issues)
		try {
			const resp = await fetch(`${RELAY_API_URL}/relay/all/off`, {
				method: 'POST',
				signal: AbortSignal.timeout(3000)
			});
			if (resp.ok) {
				Object.keys(ACTUATOR_TO_RELAY).forEach(actuatorId => {
					syncActuatorUI(actuatorId, false);
				});
				console.log('All actuators turned OFF via direct API');
				return;
			}
		} catch (e) {
			console.error('Error turning all actuators off:', e);
		}
	}

	// Initialize all actuator toggles to OFF state on page load
	function initializeActuatorsOff() {
		Object.keys(ACTUATOR_TO_RELAY).forEach(actuatorId => {
			syncActuatorUI(actuatorId, false);
		});
	}

	// Call on page load - set UI to OFF initially
	initializeActuatorsOff();

	// Periodically sync relay status with UI (every 3 seconds)
	setInterval(loadRelayStatus, 3000);

	// Check sensor thresholds for auto-activation (only when override is OFF)
	// DISABLED: Automation is handled by Raspberry Pi, not the frontend
	function checkNutrientAutoActivation(phValue, tdsValue) {
		// Frontend automation is disabled - RPi handles all automation
		// This prevents conflicts between frontend and backend automation
		return;
		
		if (actuatorOverride) return; // Skip auto-control in manual mode
		
		const now = Date.now();
		const avgPH = updateMovingAverage('ph', phValue);
		const avgTDS = updateMovingAverage('tds', tdsValue);
		const avgValues = { ph: avgPH, tds: avgTDS };

		Object.entries(NUTRIENT_THRESHOLDS).forEach(([btnId, config]) => {
			const { sensor, condition, triggerOn, triggerOff, consecutiveRequired } = config;
			const avgValue = avgValues[sensor];
			if (avgValue === undefined || isNaN(avgValue)) return;

			let thresholdBreached = false;
			if (condition === 'below' && avgValue < triggerOn) thresholdBreached = true;
			else if (condition === 'above' && avgValue > triggerOn) thresholdBreached = true;

			let shouldDeactivate = false;
			if (nutrientActiveState[btnId]) {
				if (condition === 'below' && avgValue > triggerOff) shouldDeactivate = true;
				else if (condition === 'above' && avgValue < triggerOff) shouldDeactivate = true;
			}

			if (thresholdBreached && !nutrientActiveState[btnId]) {
				consecutiveBreaches[btnId]++;
			} else if (!thresholdBreached || shouldDeactivate) {
				consecutiveBreaches[btnId] = 0;
				if (shouldDeactivate) {
					nutrientActiveState[btnId] = false;
					console.log(`[Auto] ${btnId} deactivated: ${sensor}=${avgValue.toFixed(2)}`);
				}
			}

			const shouldActivate = 
				consecutiveBreaches[btnId] >= consecutiveRequired &&
				!nutrientActiveState[btnId] &&
				(now - nutrientLastActivation[btnId]) > NUTRIENT_AUTO_COOLDOWN;

			if (shouldActivate) {
				nutrientLastActivation[btnId] = now;
				nutrientActiveState[btnId] = true;
				consecutiveBreaches[btnId] = 0;
				const relayNum = ACTUATOR_TO_RELAY[btnId];
				if (relayNum) {
					console.log(`[Auto] ${btnId} activated: ${sensor}=${avgValue.toFixed(2)} (relay ${relayNum})`);
					toggleRelay(relayNum, true, null);
					setTimeout(() => toggleRelay(relayNum, false, null), NUTRIENT_PULSE_DURATION);
				}
			}
		});
	}

	function updateSensorsAndActuators(){
		// Sensor values are now fetched from API via fetchSensorData()
		// This function only handles actuator auto-control when override is OFF
		
		// Get current sensor values from DOM for alert updates
		const phValue = document.getElementById('val-ph')?.textContent || '0';
		const doValue = document.getElementById('val-do')?.textContent?.replace(' mg/L', '') || '0';
		const tempValue = document.getElementById('val-temp')?.textContent?.replace(' °C', '') || '0';
		const humValue = document.getElementById('val-hum')?.textContent?.replace(' %', '') || '0';
		const tdsValue = document.getElementById('val-tds')?.textContent?.replace(' ppm', '') || '0';

		// Record values for sensor graphs time series
		recordSensorValue('ph', parseFloat(phValue));
		recordSensorValue('do', parseFloat(doValue));
		recordSensorValue('temp', parseFloat(tempValue));
		recordSensorValue('hum', parseFloat(humValue));
		recordSensorValue('tds', parseFloat(tdsValue));
		
		// Update alerts based on values
		updateSensorAlert('ph', phValue);
		updateSensorAlert('do', doValue);
		updateSensorAlert('temp', tempValue);
		updateSensorAlert('hum', humValue);
		updateSensorAlert('tds', tdsValue);

		// Auto-control actuators based on sensor readings (only when override is OFF)
		if (!actuatorOverride) {
			checkNutrientAutoActivation(parseFloat(phValue), parseFloat(tdsValue));
		}
	}

	// helper: set actuator state text + checkbox
	function setActuatorState(id, state){
		const checkbox = document.getElementById(id);
		if(!checkbox) return;
		const label = checkbox.closest('.toggle-switch');
		const toggleText = label ? label.querySelector('.toggle-text') : null;
		
		checkbox.checked = (state === 'ON');
		if(toggleText) toggleText.textContent = state;
	}

	// Add event listeners to actuator toggles to update text and control relays
	document.querySelectorAll('.actuator-toggle input[type="checkbox"]').forEach(checkbox => {
		checkbox.addEventListener('change', () => {
			const label = checkbox.closest('.toggle-switch');
			const toggleText = label ? label.querySelector('.toggle-text') : null;
			if(toggleText) {
				toggleText.textContent = checkbox.checked ? 'ON' : 'OFF';
			}
			// If override is ON (manual mode), send to relay API
			if (actuatorOverride) {
				const relayNum = ACTUATOR_TO_RELAY[checkbox.id];
				if (relayNum) {
					toggleRelay(relayNum, checkbox.checked, null);
				}
			}
		});
	});

	// Override toggle: ON = manual mode (user controls), OFF = auto mode (sensors control)
	// Starts ON to prevent actuators from going crazy on page load
	const overrideToggle = document.getElementById('actuatorOverrideToggle');
	if(overrideToggle){
		// Set checkbox to checked on page load (override ON = manual mode)
		overrideToggle.checked = true;
		
		const updateOverrideState = async (isInitial = false) => {
			const label = overrideToggle.closest('.toggle-switch');
			const textEl = label ? label.querySelector('.toggle-text') : null;
			const actuatorCard = overrideToggle.closest('.actuator-card');
			const wasOverride = actuatorOverride;
			actuatorOverride = overrideToggle.checked;
			if(textEl) textEl.textContent = actuatorOverride ? 'ON' : 'OFF';
			// Add/remove orange border class when override is active
			if(actuatorCard) {
				if(actuatorOverride) {
					actuatorCard.classList.add('override-active');
				} else {
					actuatorCard.classList.remove('override-active');
				}
			}
			
			// Sync with backend automation controller
			let synced = false;
			
			// On HTTPS/static hosting: use Firebase only (avoids mixed content)
			if (isStaticHosting()) {
				if (window.sendOverrideModeFirebase) {
					const ok = await window.sendOverrideModeFirebase(actuatorOverride);
					if (ok) {
						console.log(`[Firebase] Override mode synced: ${actuatorOverride}`);
						synced = true;
					} else {
						console.warn('[Firebase] Failed to sync override mode');
					}
				}
			} else {
				// On LAN: try direct RPi API
				try {
					const resp = await fetch(`${RELAY_API_URL}/override-mode`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ enabled: actuatorOverride }),
						signal: AbortSignal.timeout(3000)
					});
					if (resp.ok) {
						console.log(`[API] Override mode synced directly: ${actuatorOverride}`);
						synced = true;
					}
				} catch (e) {
					console.warn('[API] Direct override sync failed:', e.message);
				}
				// Fallback to Firebase if direct API failed
				if (!synced && window.sendOverrideModeFirebase) {
					const ok = await window.sendOverrideModeFirebase(actuatorOverride);
					if (ok) {
						console.log(`[Firebase] Override mode synced: ${actuatorOverride}`);
					} else {
						console.warn('[Firebase] Failed to sync override mode');
					}
				}
			}
			
			// When switching from MANUAL to AUTO mode:
			// DON'T send relay OFF commands - the RPi automation controller will set
			// the correct states based on sensor readings. Sending OFF commands here
			// would fight with automation (race condition via Firebase relay_commands).
			if (!isInitial && wasOverride && !actuatorOverride) {
				console.log('Switching to AUTO mode - RPi automation will control relays');
				// Just reset local UI state, automation will push real states via Firebase
				Object.keys(ACTUATOR_TO_RELAY).forEach(actuatorId => {
					syncActuatorUI(actuatorId, false);
				});
				// Reset the auto-control state
				Object.keys(nutrientActiveState).forEach(k => nutrientActiveState[k] = false);
				Object.keys(consecutiveBreaches).forEach(k => consecutiveBreaches[k] = 0);
				Object.keys(sensorHistory).forEach(k => sensorHistory[k] = []);
			}
			
			// When switching to MANUAL (override ON), send all-OFF via Firebase
			// so the RPi actually turns relays off on the hardware
			if (!isInitial && !wasOverride && actuatorOverride) {
				console.log('Switching to MANUAL mode - turning all actuators OFF');
				await turnAllActuatorsOff();
			}
			
			console.log(`Override mode: ${actuatorOverride ? 'MANUAL (user controls actuators)' : 'AUTO (sensors control actuators)'}`);
		};
		overrideToggle.addEventListener('change', () => updateOverrideState(false));
		updateOverrideState(true); // Initial call
	}

	// Nutrient solution quick actions
	function showNutrientNotification(label){
		const container = document.getElementById('notificationContainer');
		if(!container) return;
		const notif = document.createElement('div');
		notif.className = 'notification neutral';
		notif.innerHTML = `
			<div class="notification-icon">💧</div>
			<div class="notification-content">
				<div class="notification-title">Nutrient Solution</div>
				<div class="notification-message">${label} triggered</div>
			</div>
		`;
		container.appendChild(notif);
		requestAnimationFrame(() => notif.classList.add('show'));
		setTimeout(() => {
			notif.classList.remove('show');
			setTimeout(() => notif.remove(), 300);
		}, 2500);
	}

	function setupNutrientButtons(){
		const actions = [
			{ id: 'btn-ph-up', label: 'pH Up', relay: 3 },
			{ id: 'btn-ph-down', label: 'pH Down', relay: 2 },
			{ id: 'btn-leafy-green', label: 'Leafy Green', relay: 1 },
			{ id: 'btn-misting-pump', label: 'Misting Pump', relay: 4 }
		];

		actions.forEach(action => {
			const btn = document.getElementById(action.id);
			if(!btn) return;
			btn.addEventListener('click', async () => {
				if(btn.disabled) return;
				btn.disabled = true;
				btn.classList.add('is-dosing');
				btn.setAttribute('aria-pressed', 'true');
				showNutrientNotification(action.label);
				
				// Pulse the relay: ON for 2 seconds, then OFF
				if(action.relay) {
					try {
						if (isStaticHosting() && window.sendRelayCommandFirebase) {
							// Vercel: use Firebase relay commands
							await window.sendRelayCommandFirebase(`R${action.relay}`, 'ON');
							console.log(`[Nutrient] ${action.label} relay ${action.relay} ON (Firebase)`);
							setTimeout(async () => {
								await window.sendRelayCommandFirebase(`R${action.relay}`, 'OFF');
								console.log(`[Nutrient] ${action.label} relay ${action.relay} OFF (Firebase)`);
							}, 2000);
						} else {
							// LAN: use direct API
							await fetch(`${RELAY_API_URL}/relay/${action.relay}/on`, { method: 'POST' });
							console.log(`[Nutrient] ${action.label} relay ${action.relay} ON`);
							setTimeout(async () => {
								await fetch(`${RELAY_API_URL}/relay/${action.relay}/off`, { method: 'POST' });
								console.log(`[Nutrient] ${action.label} relay ${action.relay} OFF`);
							}, 2000);
						}
					} catch(err) {
						console.error(`[Nutrient] Failed to control relay ${action.relay}:`, err);
					}
				}
				
				setTimeout(() => {
					btn.disabled = false;
					btn.classList.remove('is-dosing');
					btn.setAttribute('aria-pressed', 'false');
				}, 2500);
			});
		});
	}

	setupNutrientButtons();

	// Helper to show prediction success modal
	function showPredictionSuccessModal() {
		const modal = document.getElementById('predictionSuccessModal');
		if(modal) {
			modal.style.display = 'flex';
			// Auto-close after 2 seconds
			setTimeout(() => {
				if(modal.style.display === 'flex') {
					modal.style.display = 'none';
				}
			}, 2000);
		}
	}

	function closePredictionSuccessModal() {
		const modal = document.getElementById('predictionSuccessModal');
		if(modal) modal.style.display = 'none';
	}

	// Global submit handler for prediction section
	const submitAllPredBtn = document.getElementById('submitAllPredBtn');
	if(submitAllPredBtn) {
		submitAllPredBtn.addEventListener('click', () => {
			const selectedMethod = window.selectedFarmingMethod || 'aeroponics';
			const containerId = selectedMethod === 'aeroponics' ? 'plantsGraphsContainer-aeroponics' : 'plantsGraphsContainer-dwc';
			const container = document.getElementById(containerId);
			if(!container) return;

			const cards = container.querySelectorAll('.plant-graph-card');
			const todayStr = new Date().toISOString().slice(0,10);
			let hasEmptyInputs = false;

			cards.forEach(card => {
				const inputs = card.querySelectorAll('.prediction-input');
				inputs.forEach(input => {
					if(!input.value || input.value.trim() === '') {
						hasEmptyInputs = true;
					}
				});
			});

			if(hasEmptyInputs) {
				showToast('Please fill in all actual values before submitting.', 'dangerous');
				return;
			}

			// Process all cards
			cards.forEach(card => {
				const plantKey = card.getAttribute('data-plant-key');
				const metric = card.getAttribute('data-metric');
				if(!plantKey || !metric) return;

				const inputs = card.querySelectorAll('.prediction-input');
				const payload = {};
				inputs.forEach(i => {
					const m = i.getAttribute('data-metric');
					payload[m] = i.value ? parseFloat(i.value) : null;
				});

				// store actuals
				const actualsKey = `plant_${plantKey}_actuals`;
				localStorage.setItem(actualsKey, JSON.stringify(payload));
				Object.entries(payload).forEach(([metricName, val]) => {
					const perMetricKey = `plant_${plantKey}_${metricName}_actual`;
					if(val !== null && val !== undefined && !Number.isNaN(val)) {
						localStorage.setItem(perMetricKey, String(val));
					} else {
						localStorage.removeItem(perMetricKey);
					}
				});

				// freeze predicted values
				const frozen = {};
				const metricsRow = card.querySelector('.metrics-row');
				metricsRow.querySelectorAll('.metric-value').forEach(v => {
					const m = v.getAttribute('data-metric');
					frozen[m] = parseFloat(v.getAttribute('data-value')) || parseFloat(v.textContent) || 0;
				});
				const frozenKey = `plant_${plantKey}_frozenPreds`;
				localStorage.setItem(frozenKey, JSON.stringify(frozen));
				
				// mark submission date
				const submittedKey = `plant_${plantKey}_${metric}_submittedDate`;
				localStorage.setItem(submittedKey, todayStr);

				// disable inputs
				inputs.forEach(i => i.disabled = true);

				// redraw graph
				const canvas = card.querySelector('.plant-graph-canvas');
				if(canvas) {
					const plantNum = parseInt(plantKey.split('-')[1]);
					drawPlantGraph(canvas.id, metric, plantNum, selectedMethod);
				}
			});

			// Show success modal with submitted data
			showPredictionSuccessModal();
			showToast('All predictions submitted successfully!', 'success');
		});
	}

	// Prediction success modal closes automatically - no click handlers needed

	// initial draw and periodic updates - wait a bit for layout to settle
	setTimeout(() => {
		console.log('Startup initialization starting...');
		drawMini('mini1'); drawMini('mini2'); drawMini('mini3'); updateSensorsAndActuators();
		// Initialize comparison graph
		drawComparisonGraph();
		setupGraphHover();
		// Initialize delete button visibility for all plant lists
		toggleDeleteButtonsVisibility('#traditionalPlantsList');
		toggleDeleteButtonsVisibility('#dwcPlantsList');
		toggleDeleteButtonsVisibility('#aeroponicsPlantsList');
	}, 100);
	
	setInterval(()=>{ drawMini('mini1'); drawMini('mini2'); drawMini('mini3'); updateSensorsAndActuators(); }, 5000);
	
	// Handle window resize for responsive canvas
	let resizeTimeout;
	window.addEventListener('resize', () => {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(() => {
			drawMini('mini1');
			drawMini('mini2');
			drawMini('mini3');
			drawComparisonGraph();
		}, 250);
	});
	
	// Time period button handlers for comparison graph
	const timeButtons = document.querySelectorAll('.time-btn');
	timeButtons.forEach(btn => {
		btn.addEventListener('click', () => {
			timeButtons.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			const daysAttr = btn.getAttribute('data-days');
			currentDays = daysAttr === 'all' ? 'all' : parseInt(daysAttr);
			graphDataCache = {}; // Clear cache when changing time period
			drawComparisonGraph();
		});
	});

	// Metric button handlers (height, width, length, leaves, branches)
	const metricButtons = document.querySelectorAll('.metric-btn');
	metricButtons.forEach(btn => {
		btn.addEventListener('click', () => {
			metricButtons.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');
			currentMetric = btn.getAttribute('data-metric') || 'height';
			graphDataCache = {}; // Clear cache when changing metric
			drawComparisonGraph();
		});
	});

// Topbar clock: update date and time every second
function updateTopbarClock() {
	const timeEl = document.getElementById('topbarTime');
	const dateEl = document.getElementById('topbarDate');
	if(!timeEl || !dateEl) return;
	const now = new Date();
	const hh = String(now.getHours()).padStart(2,'0');
	const mm = String(now.getMinutes()).padStart(2,'0');
	const ss = String(now.getSeconds()).padStart(2,'0');
	timeEl.textContent = `${hh}:${mm}:${ss}`;
	// Build a richer date display: short weekday, short month+day, and year
	const weekday = now.toLocaleDateString(undefined, { weekday: 'short' }); // e.g. "Thu"
	const monthDay = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); // e.g. "Jan 16"
	const year = now.getFullYear();
	dateEl.innerHTML = `
		<span class="tb-weekday">${weekday}</span>
		<span class="tb-monthday">${monthDay}</span>
		<span class="tb-year">${year}</span>
	`;
	// tooltip with full localized datetime
	dateEl.title = now.toLocaleString();
}

// start clock after DOM ready
setTimeout(() => {
	updateTopbarClock();
	setInterval(updateTopbarClock, 1000);
}, 200);

	// Traditional Farming: Add plant row handler
	const addTraditionalPlantBtn = document.getElementById('addTraditionalPlant');
	const traditionalPlantsList = document.getElementById('traditionalPlantsList');

	function addTraditionalPlantCardRow() {
			// Append new plant row inside the existing green card, not a new card
			const card = traditionalPlantsList.querySelector('.sensor-input-card1');
			if (!card) return;

			const existingRows = card.querySelectorAll('.sensor-inputs-row1');
			const rowNum = existingRows.length + 1;

			const newRow = document.createElement('div');
			newRow.className = 'sensor-inputs-row1';
			newRow.innerHTML = `
					<div class="sensor-column1 sensor-column-with-delete">
						<label class="sensor-input-label1">
							<span class="sensor-label-text1">No</span>
							<span class="sensor-number-display1">${rowNum}</span>
						</label>
						<button class="row-delete-btn" title="Delete row"><img src="../negativesign.png" alt="Delete"></button>
					</div>
					<div class="sensor-column1">
						<label class="sensor-input-label1">
							<span class="sensor-label-text1">Height</span>
							<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="height" placeholder="">
						</label>
					</div>
					<div class="sensor-column1">
						<label class="sensor-input-label1">
							<span class="sensor-label-text1">Length</span>
							<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="length" placeholder="">
						</label>
					</div>
					<div class="sensor-column1">
						<label class="sensor-input-label1">
							<span class="sensor-label-text1">Width</span>
							<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="width" placeholder="">
						</label>
					</div>
					<div class="sensor-column1">
						<label class="sensor-input-label1">
							<span class="sensor-label-text1">No. of Leaves</span>
							<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="leaves" placeholder="">
						</label>
					</div>
					<div class="sensor-column1">
						<label class="sensor-input-label1">
							<span class="sensor-label-text1">No. of Branches</span>
							<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="branches" placeholder="">
						</label>
					</div>
				`;

			card.appendChild(newRow);
			toggleDeleteButtonsVisibility('#traditionalPlantsList');
			// Force layout recalculation for flexible layout adjustment
			window.dispatchEvent(new Event('resize'));
	}

	if(addTraditionalPlantBtn) {
		addTraditionalPlantBtn.addEventListener('click', addTraditionalPlantCardRow);
	}

	// Deep Water Culture: Add plant row handler
	const addDwcPlantBtn = document.getElementById('addDwcPlant');
	const dwcPlantsList = document.getElementById('dwcPlantsList');

	function addDwcPlantCardRow() {
		// Append new plant row inside the existing green card, not a new card
		const card = dwcPlantsList.querySelector('.sensor-input-card1');
		if (!card) return;

		const existingRows = card.querySelectorAll('.sensor-inputs-row1');
		const rowNum = existingRows.length + 1;

		const newRow = document.createElement('div');
		newRow.className = 'sensor-inputs-row1';
		newRow.innerHTML = `
				<div class="sensor-column1 sensor-column-with-delete">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No</span>
						<span class="sensor-number-display1">${rowNum}</span>
					</label>
					<button class="row-delete-btn" title="Delete row"><img src="../negativesign.png" alt="Delete"></button>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Height</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="height" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Length</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="length" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Width</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="width" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No. of Leaves</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="leaves" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No. of Branches</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="branches" placeholder="">
					</label>
				</div>
			`;

		card.appendChild(newRow);
		toggleDeleteButtonsVisibility('#dwcPlantsList');
		// Force layout recalculation for flexible layout adjustment
		window.dispatchEvent(new Event('resize'));
	}

	if(addDwcPlantBtn) {
		addDwcPlantBtn.addEventListener('click', addDwcPlantCardRow);
	}

	// Aeroponics: Add plant row handler
	const addAeroponicsPlantBtn = document.getElementById('addAeroponicsPlant');
	const aeroponicsPlantsList = document.getElementById('aeroponicsPlantsList');

	function addAeroponicsPlantCardRow() {
		// Append new plant row inside the existing green card, not a new card
		const card = aeroponicsPlantsList?.querySelector('.sensor-input-card1');
		if (!card) return;

		const existingRows = card.querySelectorAll('.sensor-inputs-row1');
		const rowNum = existingRows.length + 1;

		const newRow = document.createElement('div');
		newRow.className = 'sensor-inputs-row1';
		newRow.innerHTML = `
				<div class="sensor-column1 sensor-column-with-delete">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No</span>
						<span class="sensor-number-display1">${rowNum}</span>
					</label>
					<button class="row-delete-btn" title="Delete row"><img src="../negativesign.png" alt="Delete"></button>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Height</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="height" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Length</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="length" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Width</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="width" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No. of Leaves</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="leaves" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No. of Branches</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="branches" placeholder="">
					</label>
				</div>
			`;

		card.appendChild(newRow);
		toggleDeleteButtonsVisibility('#aeroponicsPlantsList');
		// Force layout recalculation for flexible layout adjustment
		window.dispatchEvent(new Event('resize'));
	}

	if(addAeroponicsPlantBtn) {
		addAeroponicsPlantBtn.addEventListener('click', addAeroponicsPlantCardRow);
	}

	// Helper function to renumber rows in a plant list
	function renumberPlantRows(listSelector) {
		const list = document.querySelector(listSelector);
		if (!list) return;
		const rows = list.querySelectorAll('.sensor-inputs-row1');
		rows.forEach((row, idx) => {
			const numberDisplay = row.querySelector('.sensor-number-display1');
			if (numberDisplay) {
				numberDisplay.textContent = idx + 1;
			}
		});
	}

	// Helper function to toggle delete button visibility based on row count
	function toggleDeleteButtonsVisibility(listSelector) {
		const list = document.querySelector(listSelector);
		if (!list) return;
		const card = list.querySelector('.sensor-input-card1');
		if (!card) return;
		const rows = card.querySelectorAll('.sensor-inputs-row1');
		const deleteButtons = card.querySelectorAll('.row-delete-btn');

		if (rows.length === 1) {
			// Hide delete button if only 1 row
			deleteButtons.forEach(btn => btn.style.display = 'none');
		} else {
			// Show delete buttons if more than 1 row
			deleteButtons.forEach(btn => btn.style.display = 'flex');
		}
	}

	// Delete row functionality for Traditional, DWC, and Aeroponics
	let deleteInProgress = false;
	
	document.addEventListener('click', (e) => {
		// Check if click target is the button or the image inside it
		const btn = e.target.closest('.row-delete-btn');
		if (!btn) return;
		
		// Prevent multiple rapid clicks
		if (deleteInProgress) return;
		deleteInProgress = true;
		
		const row = btn.closest('.sensor-inputs-row1');
		if (!row) {
			deleteInProgress = false;
			return;
		}

		// Find which list this row belongs to
		const card = row.closest('.sensor-input-card1');
		const list = card?.closest('[id$="PlantsList"]');

		if (card && list) {
			const rows = card.querySelectorAll('.sensor-inputs-row1');
			
			// Only delete if there's more than one row
			if (rows.length > 1) {
				row.remove();
				
				// Renumber remaining rows based on which list
				if (list.id === 'traditionalPlantsList') {
					renumberPlantRows('#traditionalPlantsList');
					toggleDeleteButtonsVisibility('#traditionalPlantsList');
				} else if (list.id === 'dwcPlantsList') {
					renumberPlantRows('#dwcPlantsList');
					toggleDeleteButtonsVisibility('#dwcPlantsList');
				} else if (list.id === 'aeroponicsPlantsList') {
					renumberPlantRows('#aeroponicsPlantsList');
					toggleDeleteButtonsVisibility('#aeroponicsPlantsList');
				}
			}
		}
		
		// Allow next delete after a short delay
		setTimeout(() => {
			deleteInProgress = false;
		}, 100);
	});

	// Also add delete button to dynamically added rows
	function addDeleteButtonToRow(row) {
		const firstColumn = row.querySelector('.sensor-column1:first-child');
		if (firstColumn && !firstColumn.querySelector('.row-delete-btn')) {
			firstColumn.classList.add('sensor-column-with-delete');
			const deleteBtn = document.createElement('button');
			deleteBtn.className = 'row-delete-btn';
			deleteBtn.title = 'Delete row';
			deleteBtn.textContent = '−';
			firstColumn.appendChild(deleteBtn);
		}
	}



	// Aeroponics: Clear and Submit handlers
	function clearAeroponicsPlantList() {
		const list = document.getElementById('aeroponicsPlantsList');
		if (!list) return;
		const card = list.querySelector('.sensor-input-card1');
		if (!card) return;

		// Reset to a single empty row
		card.innerHTML = `
			<div class="sensor-inputs-row1">
				<div class="sensor-column1 sensor-column-with-delete">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No</span>
						<span class="sensor-number-display1">1</span>
					</label>
					<button class="row-delete-btn" title="Delete row"><img src="../negativesign.png" alt="Delete"></button>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Height</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="height" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Length</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="length" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">Width</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="width" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No. of Leaves</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="leaves" placeholder="">
					</label>
				</div>
				<div class="sensor-column1">
					<label class="sensor-input-label1">
						<span class="sensor-label-text1">No. of Branches</span>
						<input type="number" step="0.1" class="sensor-input1" data-sensor="all" data-field="branches" placeholder="">
					</label>
				</div>
			</div>
		`;
		toggleDeleteButtonsVisibility('#aeroponicsPlantsList');
	}

	// Validation error modal handlers
	function showValidationError() {
		const modal = document.getElementById('validationErrorModal');
		if (modal) {
			modal.style.display = 'flex';
		}
	}

	function closeValidationError() {
		const modal = document.getElementById('validationErrorModal');
		if (modal) {
			modal.style.display = 'none';
		}
	}

	// Success modal handlers
	function showSuccessModal(submittedData) {
		const modal = document.getElementById('successModal');
		if (modal) {
			modal.style.display = 'flex';
			// Auto-close after 2 seconds
			setTimeout(() => {
				if(modal.style.display === 'flex') {
					modal.style.display = 'none';
					clearAllFields();
				}
			}, 2000);
		}
	}

	function closeSuccessModal() {
		const modal = document.getElementById('successModal');
		if (modal) {
			modal.style.display = 'none';
		}
	}

	async function submitAeroponicsPlantList() {
		console.log('[Training Submit] Button clicked');
		
		// Wait for API URL to be initialized
		try {
			await waitForAPIUrl();
			console.log('[Training Submit] API URL ready:', RELAY_API_URL);
		} catch (e) {
			console.error('[Training Submit] Error waiting for API URL:', e);
		}

		// Determine farming system from active tab
		const activeTab = document.querySelector('.training-tab-btn.active');
		const tabSensor = activeTab?.getAttribute('data-sensor') || 'training-aero';
		let farmingSystem, listId;
		
		if (tabSensor === 'training-aero') {
			farmingSystem = 'aeroponics';
			listId = 'aeroponicsPlantsList';
		} else if (tabSensor === 'training-dwc') {
			farmingSystem = 'dwc';
			listId = 'dwcPlantsList';
		} else {
			farmingSystem = 'traditional';
			listId = 'traditionalPlantsList';
		}
		
		console.log('[Training Submit] Farming system:', farmingSystem, 'List ID:', listId);
		
		const list = document.getElementById(listId);
		if (!list) {
			console.warn(`[Training Submit] Could not find ${listId}`);
			showValidationError();
			return;
		}
		const card = list.querySelector('.sensor-input-card1');
		if (!card) {
			console.warn('[Training Submit] Could not find sensor-input-card1');
			showValidationError();
			return;
		}

		const rows = Array.from(card.querySelectorAll('.sensor-inputs-row1'));
		console.log('[Training Submit] Found', rows.length, 'plant rows');
		
		const data = rows.map((row, idx) => {
			return {
				no: idx + 1,
				height: row.querySelector('[data-field="height"]')?.value || '',
				length: row.querySelector('[data-field="length"]')?.value || '',
				width: row.querySelector('[data-field="width"]')?.value || '',
				leaves: row.querySelector('[data-field="leaves"]')?.value || '',
				branches: row.querySelector('[data-field="branches"]')?.value || ''
			};
		});

		console.log('[Training Submit] Collected data:', data);

		// Validate all fields are filled
		const hasEmptyFields = data.some(plant => 
			!plant.height || !plant.length || !plant.width || !plant.leaves || !plant.branches
		);

		if (hasEmptyFields) {
			console.warn('[Training Submit] Validation failed - empty fields detected');
			showValidationError();
			return;
		}

		// Submit each plant's data to Firebase or API
		try {
			for (const plant of data) {
				const payload = {
					plant_id: plant.no,
					farming_system: farmingSystem,
					leaves: parseFloat(plant.leaves) || null,
					branches: parseFloat(plant.branches) || null,
					height: parseFloat(plant.height) || null,
					weight: parseFloat(plant.width) || null,
					length: parseFloat(plant.length) || null
				};

				console.log(`[Training Submit] Submitting plant ${plant.no}:`, payload);

				// Use Firebase on static hosting (Vercel)
				if (isStaticHosting() && window.savePlantReadingFirebase) {
					const success = await window.savePlantReadingFirebase(payload);
					if (!success) {
						console.error(`[Training Submit] Failed to submit plant ${plant.no} to Firebase`);
					} else {
						console.log(`[Training Submit] Plant ${plant.no} submitted to Firebase`);
					}
				} else {
					// Use API when available
					const res = await fetch(`${RELAY_API_URL}/plant-reading`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload)
					});

					if (!res.ok) {
						const errText = await res.text();
						console.error(`[Training Submit] Failed to submit plant ${plant.no}:`, res.status, errText);
					} else {
						const resData = await res.json();
						console.log(`[Training Submit] Plant ${plant.no} submitted successfully:`, resData);
					}
				}
			}

			// Show success modal
			console.log('[Training Submit] All plants submitted - showing success message');
			showSuccessModal(data);
			showToast(`${data.length} plant${data.length > 1 ? 's' : ''} submitted to history!`, 'success');
			
			// Clear fields after successful submission
			clearAllFields();
		} catch (error) {
			console.error('[Training Submit] Error submitting plant readings:', error);
			showToast('Failed to submit plant readings. Check console for details.', 'dangerous');
		}
	}

	function clearAllFields() {
		// Clear sensor readings
		const sensorCard = document.querySelector('[data-sensor="all"]');
		if (sensorCard) {
			const inputs = sensorCard.querySelectorAll('input');
			inputs.forEach(input => input.value = '');
		}

		// Clear traditional farming
		const traditionalList = document.getElementById('traditionalPlantsList');
		if (traditionalList) {
			const inputs = traditionalList.querySelectorAll('input');
			inputs.forEach(input => input.value = '');
		}

		// Clear DWC
		const dwcList = document.getElementById('dwcPlantsList');
		if (dwcList) {
			const inputs = dwcList.querySelectorAll('input');
			inputs.forEach(input => input.value = '');
		}

		// Clear Aeroponics
		const aeroList = document.getElementById('aeroponicsPlantsList');
		if (aeroList) {
			const inputs = aeroList.querySelectorAll('input');
			inputs.forEach(input => input.value = '');
		}
	}

	const clearBtn = document.getElementById('clear');
	if (clearBtn) {
		clearBtn.addEventListener('click', clearAllFields);
	}

	const submitBtn = document.getElementById('submit-btn');
	if (submitBtn) {
		submitBtn.addEventListener('click', submitAeroponicsPlantList);
	}

	// Validation error modal event listeners
	const validationCloseBtn = document.getElementById('validationErrorClose');
	if (validationCloseBtn) {
		validationCloseBtn.addEventListener('click', closeValidationError);
	}

	const validationCloseBtn2 = document.getElementById('validationErrorClose2');
	if (validationCloseBtn2) {
		validationCloseBtn2.addEventListener('click', closeValidationError);
	}

	const validationModal = document.getElementById('validationErrorModal');
	if (validationModal) {
		validationModal.addEventListener('click', (e) => {
			if (e.target === validationModal) {
				closeValidationError();
			}
		});
	}

	// Success modal closes automatically - no click handlers needed

	// Calibration apply (only if element exists)
	const applyCal = document.getElementById('applyCal');
	if (applyCal) {
		applyCal.addEventListener('click', ()=>{
			const sensor = document.getElementById('calSensor').value;
			const offset = parseFloat(document.getElementById('calOffset').value) || 0;
			alert(`Applied calibration offset ${offset} to ${sensor}`);
		});
	}




});

// Metric info configuration (global)
const metricInfo = {
	leaves: { 
		label: 'Number of Leaves', 
		unit: 'leaves', 
		range: [5, 25], 
		description: 'Predicted leaf count based on growth model for all plants.'
	},
	width: { 
		label: 'Width', 
		unit: 'cm', 
		range: [0.5, 3.5], 
		description: 'Estimated plant width over time for all plants.'
	},
	height: { 
		label: 'Height', 
		unit: 'cm', 
		range: [20, 80], 
		description: 'Predicted plant height progression for all plants.'
	},
	length: { 
		label: 'Length', 
		unit: 'cm', 
		range: [15, 60], 
		description: 'Expected stem/vine length for all plants.'
	},
	branches: { 
		label: 'Number of Branches', 
		unit: 'branches', 
		range: [2, 12], 
		description: 'Forecasted branch count for all plants.'
	}
};

// Helper: deterministic pseudo-random predicted value per metric/plant/day
function computePredictedValue(metric, plantNum, dateStr) {
	const info = metricInfo[metric];
	if(!info) return 0;
	const seed = `${metric}:${plantNum}:${dateStr}`;
	let s = 0;
	for(let i=0;i<seed.length;i++) s = (s * 31 + seed.charCodeAt(i)) & 0xffffffff;
	// map s to 0..1
	const frac = (s >>> 0) / 4294967295;
	const [minVal, maxVal] = info.range;
	return minVal + frac * (maxVal - minVal);
}

function formatPred(val) {
	return Number.isFinite(val) ? Number(val).toFixed(1) : '--';
}

// Generate an array of date labels starting from `startDateStr` (ISO yyyy-mm-dd) for `count` days
function generateDateLabels(startDateStr, count) {
	const labels = [];
	const date = new Date(startDateStr + 'T00:00:00');
	// Shift displayed dates forward one day (user preference): Jan 15 -> Jan 16, etc.
	for (let i = 0; i < count; i++) {
		const d = new Date(date.getTime());
		d.setDate(date.getDate() + i + 1);
		const opts = { month: 'short', day: 'numeric' };
		labels.push({ iso: d.toISOString().slice(0,10), display: d.toLocaleDateString(undefined, opts) });
	}
	return labels;
}

// Show an in-page toast notification using the #notificationContainer element
function showToast(message, type = 'neutral', timeout = 4000) {
	const container = document.getElementById('notificationContainer');
	if(!container) return;
	const icon = type === 'dangerous' ? '⚠️' : (type === 'success' ? '✅' : 'ℹ️');
	const note = document.createElement('div');
	note.className = `notification show ${type}`;
	note.innerHTML = `
		<div class="notification-icon">${icon}</div>
		<div class="notification-content">${message}</div>
		<button class="notification-close" aria-label="close">&times;</button>
	`;
	container.appendChild(note);
	const closeBtn = note.querySelector('.notification-close');
	if(closeBtn) {
		closeBtn.addEventListener('click', () => note.remove());
	}
	setTimeout(() => { if(note.parentNode) note.remove(); }, timeout);
}

// Delegate submit clicks for static or dynamically generated submit buttons.
document.addEventListener('click', function(e) {
	const btn = e.target.closest && e.target.closest('.submit-pred-btn');
	if(!btn) return;
	// find the parent plant card and its prediction input panel
	const card = btn.closest('.plant-graph-card');
	const panel = card ? card.querySelector('.prediction-input-panel') : null;
	const inputs = panel ? panel.querySelectorAll('input.prediction-input') : [];
	if(inputs.length === 0) return; // nothing to validate here
	let allFilled = true;
	inputs.forEach(i => { if(!i.value || String(i.value).trim() === '') allFilled = false; });
	if(!allFilled) {
		// show the in-page notification and stop further handlers
		showToast('Please fill in all actual values before submitting.', 'dangerous');
		e.preventDefault();
		e.stopPropagation();
		return;
	}
	// otherwise allow existing handlers (if any) to proceed
});

function generatePlantGraphs(metric, farmingMethod = 'aeroponics') {
	const containerId = farmingMethod === 'aeroponics' ? 'plantsGraphsContainer-aeroponics' : 'plantsGraphsContainer-dwc';
	const container = document.getElementById(containerId);
	if(!container) return;
	
	// Clear existing graphs
	container.innerHTML = '';
	
	const info = metricInfo[metric];
	if(!info) return;
	
	// Determine number of plants based on farming method and what data was submitted
	// Get the plant data from the training section
	let plantCount = 0;
	let plantData = [];
	
	if(farmingMethod === 'aeroponics') {
		const aeroPlantsContainer = document.getElementById('aeroponicsPlantsList');
		if(aeroPlantsContainer) {
			const plantRows = aeroPlantsContainer.querySelectorAll('.sensor-input-card1');
			plantCount = plantRows.length;
			plantData = Array.from(plantRows).map((row, idx) => ({
				plantNum: idx + 1,
				method: 'aeroponics'
			}));
		}
	} else if(farmingMethod === 'dwc') {
		const dwcPlantsContainer = document.getElementById('dwcPlantsList');
		if(dwcPlantsContainer) {
			const plantRows = dwcPlantsContainer.querySelectorAll('.sensor-input-card1');
			plantCount = plantRows.length;
			plantData = Array.from(plantRows).map((row, idx) => ({
				plantNum: idx + 1,
				method: 'dwc'
			}));
		}
	}
	
	// Ensure exactly 6 plants are shown
	if(plantCount <= 0) {
		plantCount = 6;
		for(let i = 1; i <= plantCount; i++) {
			plantData.push({ plantNum: i, method: farmingMethod });
		}
	} else {
		// Trim or pad to 6 plants
		if(plantCount > 6) {
			plantData = plantData.slice(0, 6);
			plantCount = 6;
		} else if(plantCount < 6) {
			const start = plantCount + 1;
			for(let i = start; i <= 6; i++) {
				plantData.push({ plantNum: i, method: farmingMethod });
			}
			plantCount = 6;
		}
	}
	
	// Create plant graph cards
	plantData.forEach(plant => {
		const card = document.createElement('div');
		card.className = 'plant-graph-card';

		const header = document.createElement('div');
		header.className = 'card-header';
		header.textContent = `Plant ${plant.plantNum}`;

		// Metrics row (side-by-side predicted and actual)
		const metricsRow = document.createElement('div');
		metricsRow.className = 'metrics-row metrics-row-sidebyside';

		// Show only the currently selected metric on the card/input panel
		const metricsList = [metric];
		const todayStr = new Date().toISOString().slice(0,10);
		const plantKey = `${farmingMethod}-${plant.plantNum}`;
		const frozenKey = `plant_${plantKey}_frozenPreds`;
		const submittedKey = `plant_${plantKey}_${metric}_submittedDate`;
		const metricKeys = ['leaves','branches','height','width','length'];

		// If there was a submission on a previous date, clear the saved actuals so inputs reset next day
		const prevSubmitted = localStorage.getItem(submittedKey);
		if(prevSubmitted && prevSubmitted !== todayStr) {
			localStorage.removeItem(`plant_${plantKey}_actuals`);
			metricKeys.forEach(m => localStorage.removeItem(`plant_${plantKey}_${m}_actual`));
			localStorage.removeItem(submittedKey);
		}

		let frozenPreds = null;
		try { frozenPreds = JSON.parse(localStorage.getItem(frozenKey)); } catch(e) { frozenPreds = null; }

		// Create side-by-side predicted and actual layout
		metricsList.forEach(m => {
			// predicted value either frozen (if previously submitted) or computed for today
			let predVal;
			if(frozenPreds && typeof frozenPreds[m] !== 'undefined') predVal = frozenPreds[m];
			else predVal = computePredictedValue(m, plant.plantNum, todayStr);

			// Predicted card
			const predCard = document.createElement('div');
			predCard.className = 'metric-card metric-predicted';
			const predLabel = document.createElement('div');
			predLabel.className = 'metric-label';
			predLabel.textContent = `PREDICTED ${(metricInfo[m] ? metricInfo[m].label : m).toUpperCase()}`;
			const predValue = document.createElement('div');
			predValue.className = 'metric-value';
			predValue.textContent = formatPred(predVal);
			predValue.setAttribute('data-metric', m);
			predValue.setAttribute('data-value', predVal);
			predCard.appendChild(predLabel);
			predCard.appendChild(predValue);

			// Actual card with input
			const actualCard = document.createElement('div');
			actualCard.className = 'metric-card metric-actual';
			const actualLabel = document.createElement('div');
			actualLabel.className = 'metric-label';
			actualLabel.textContent = `ACTUAL ${(metricInfo[m] ? metricInfo[m].label : m).toUpperCase()}`;
			const actualInput = document.createElement('input');
			actualInput.type = 'number';
			actualInput.step = '0.1';
			actualInput.className = 'metric-input prediction-input';
			actualInput.setAttribute('data-metric', m);
			actualInput.id = `actual-${plantKey}-${m}`;
			actualInput.placeholder = '0.0';
			
			// preload previously submitted actuals
			const actualsKey = `plant_${plantKey}_actuals`;
			const metricKey = `plant_${plantKey}_${m}_actual`;
			let storedActuals = null;
			let metricVal = null;
			try { storedActuals = JSON.parse(localStorage.getItem(actualsKey)); } catch(e) { storedActuals = null; }
			const metricStored = localStorage.getItem(metricKey);
			if(metricStored !== null && metricStored !== undefined) {
				const parsed = parseFloat(metricStored);
				if(Number.isFinite(parsed)) metricVal = parsed;
			} else if(storedActuals && typeof storedActuals[m] !== 'undefined') {
				metricVal = storedActuals[m];
			}
			if(Number.isFinite(metricVal)) actualInput.value = metricVal;
			
			actualCard.appendChild(actualLabel);
			actualCard.appendChild(actualInput);

			metricsRow.appendChild(predCard);
			metricsRow.appendChild(actualCard);
		});

		// Canvas area
		const canvas = document.createElement('canvas');
		canvas.className = 'plant-graph-canvas';
		canvas.id = `plant-${plant.plantNum}-${farmingMethod}-graph`;
		canvas.width = 600;
		canvas.height = 250;

		// Legend panel below graph
		const legendPanel = document.createElement('div');
		legendPanel.className = 'canvas-legend';
		legendPanel.innerHTML = `
			<div class="legend-item"><span class="legend-swatch actual"></span><span>Actual</span></div>
			<div class="legend-item"><span class="legend-swatch predicted"></span><span>Predicted</span></div>
		`;

		card.appendChild(header);
		card.appendChild(metricsRow);
		card.appendChild(canvas);
		card.appendChild(legendPanel);

		// Add "Show all" button to the card (bottom-right)
		const showAllBtn = document.createElement('button');
		showAllBtn.className = 'btn show-all-btn';
		showAllBtn.setAttribute('aria-label', 'Show all data');
		showAllBtn.textContent = 'Show all';
		showAllBtn.addEventListener('click', () => {
			openShowAllModal(plant.plantNum, farmingMethod, metric);
		});
		card.appendChild(showAllBtn);
		container.appendChild(card);

		// If submitted today, disable inputs
		const submittedDate = localStorage.getItem(submittedKey);
		if(submittedDate === todayStr) {
			// disable inputs
			const inputs = card.querySelectorAll('.prediction-input');
			inputs.forEach(i => i.disabled = true);
		}

		// Store plant key and metric for later submission
		card.setAttribute('data-plant-key', plantKey);
		card.setAttribute('data-metric', metric);

		// Draw graph for this plant
		setTimeout(() => {
			drawPlantGraph(canvas.id, metric, plant.plantNum, farmingMethod);
		}, 50);
	});
}

function drawPlantGraph(canvasId, metric, plantNum, farmingMethod = 'aeroponics') {
	const canvas = document.getElementById(canvasId);
	if(!canvas || !canvas.getContext) return;
	
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	
	const w = canvas.width, h = canvas.height;
	ctx.clearRect(0, 0, w, h);
	
	const info = metricInfo[metric];
	if(!info) return;
	
	const leftPad = 50, rightPad = 20, topPad = 20, bottomPad = 40;
	const [minVal, maxVal] = info.range;
	
	// Draw background
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, w, h);
	
	// Draw horizontal grid lines and y-axis ticks
	ctx.fillStyle = '#6c7380';
	ctx.font = '11px Segoe UI, Arial, sans-serif';
	ctx.textAlign = 'right';
	
	const yTicks = [minVal, (minVal + maxVal) / 2, maxVal];
	yTicks.forEach(val => {
		const y = topPad + (1 - (val - minVal) / (maxVal - minVal)) * (h - topPad - bottomPad);
		
		// Grid line
		ctx.strokeStyle = '#e8ecf4';
		ctx.lineWidth = 1;
		ctx.setLineDash([5, 5]);
		ctx.beginPath();
		ctx.moveTo(leftPad, y);
		ctx.lineTo(w - rightPad, y);
		ctx.stroke();
		ctx.setLineDash([]);
		
		// Y-axis label
		ctx.fillText(val.toFixed(1), leftPad - 12, y + 4);
	});
	
	// Draw vertical grid lines
	ctx.strokeStyle = '#f0f4f8';
	ctx.lineWidth = 1;
	for(let i = 0; i <= 5; i++) {
		const x = leftPad + (i / 5) * (w - leftPad - rightPad);
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(x, topPad);
		ctx.lineTo(x, h - bottomPad);
		ctx.stroke();
		ctx.setLineDash([]);
	}
	
	// Prepare or reuse datasets for this canvas so toggles/redraws use consistent series
	if(!canvas._actualData || !canvas._predictedData) {
		// Use a daily series from Jan 15 to Jan 22 (inclusive) to match requested per-day data
		const dateLabels = generateDateLabels('2026-01-15', 8); // 8 days: Jan15..Jan22
		const nPoints = dateLabels.length;
		const baseValue = (minVal + maxVal) / 2;
		const variance = (maxVal - minVal) / 8;
		const plantVariance = (plantNum - 3.5) * (variance * 0.3);
		const actual = window.randomWalk(nPoints, baseValue + plantVariance, variance)
			.map(v => Math.max(minVal, Math.min(maxVal, v)));
		// default predicted derived from actual
		let predictedSeries = actual.map((v, i) => {
			const trend = (i / actual.length) * (variance * 0.6);
			const bias = plantVariance * 0.25;
			return Math.max(minVal, Math.min(maxVal, v + trend + bias));
		});

		// If a frozen predicted value exists for this plant/metric, use it to build a stable predicted series
		try {
			const frozenKey = `plant_${farmingMethod}-${plantNum}_frozenPreds`;
			const frozen = JSON.parse(localStorage.getItem(frozenKey));
			if(frozen && typeof frozen[metric] !== 'undefined') {
				const frozenVal = parseFloat(frozen[metric]);
				if(Number.isFinite(frozenVal)) {
					predictedSeries = new Array(actual.length).fill(frozenVal);
				}
			}
		} catch(e) {
			// ignore
		}

		// attach dateLabels to canvas for x-axis rendering and tooltip use
		canvas._dateLabels = dateLabels;
		canvas._actualData = actual;
		canvas._predictedData = predictedSeries;
	}

	const data = canvas._actualData;
	const predicted = canvas._predictedData;

	// Draw smooth area/lines using stored data
	const plotW = w - leftPad - rightPad;
	const plotH = h - topPad - bottomPad;

	// Create gradient fill for actual
	const gradient = ctx.createLinearGradient(leftPad, topPad, leftPad, h - bottomPad);
	gradient.addColorStop(0, 'rgba(43, 110, 246, 0.2)');
	gradient.addColorStop(1, 'rgba(43, 110, 246, 0)');

	// Build point lists
	const points = [];
	data.forEach((val, i) => {
		const x = leftPad + (i / (data.length - 1)) * plotW;
		const y = topPad + (1 - (val - minVal) / (maxVal - minVal)) * plotH;
		points.push({x, y, v: val});
	});

	const predPoints = [];
	predicted.forEach((val, i) => {
		const x = leftPad + (i / (predicted.length - 1)) * plotW;
		const y = topPad + (1 - (val - minVal) / (maxVal - minVal)) * plotH;
		predPoints.push({x, y, v: val});
	});

	// Filled area (Actual) if enabled
	if(canvas._showActual === undefined) canvas._showActual = true;
	if(canvas._showPredicted === undefined) canvas._showPredicted = true;

	if(canvas._showActual) {
		ctx.beginPath();
		points.forEach((p, i) => {
			if(i === 0) ctx.moveTo(p.x, p.y);
			else {
				const prev = points[i-1];
				const cpX = (prev.x + p.x) / 2;
				const cpY = (prev.y + p.y) / 2;
				ctx.quadraticCurveTo(prev.x, prev.y, cpX, cpY);
			}
		});
		ctx.lineTo(points[points.length - 1].x, h - bottomPad);
		ctx.lineTo(points[0].x, h - bottomPad);
		ctx.closePath();
		ctx.fillStyle = gradient;
		ctx.fill();
	}

	// Draw predicted (dashed) below actual markers
	ctx.beginPath();
	predPoints.forEach((p, i) => {
		if(i === 0) ctx.moveTo(p.x, p.y);
		else {
			const prev = predPoints[i-1];
			const cpX = (prev.x + p.x) / 2;
			const cpY = (prev.y + p.y) / 2;
			ctx.quadraticCurveTo(prev.x, prev.y, cpX, cpY);
		}
	});
	ctx.setLineDash([6,6]);
	ctx.strokeStyle = '#facc15';
	ctx.lineWidth = 2.5;
	if(canvas._showPredicted) ctx.stroke();
	ctx.setLineDash([]);

	// Draw actual line on top
	ctx.beginPath();
	points.forEach((p, i) => {
		if(i === 0) ctx.moveTo(p.x, p.y);
		else {
			const prev = points[i-1];
			const cpX = (prev.x + p.x) / 2;
			const cpY = (prev.y + p.y) / 2;
			ctx.quadraticCurveTo(prev.x, prev.y, cpX, cpY);
		}
	});
	ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].x, points[points.length - 1].y);
	ctx.strokeStyle = '#2b6ef6';
	ctx.lineWidth = 3;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.shadowColor = 'rgba(43, 110, 246, 0.3)';
	ctx.shadowBlur = 6;
	if(canvas._showActual) ctx.stroke();
	ctx.shadowBlur = 0;

	// Draw markers for actual
	points.forEach((p, i) => {
		if(i % 5 === 0 || i === points.length - 1) {
			if(canvas._showActual) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, 5, 0, Math.PI*2);
				ctx.fillStyle = '#ffffff';
				ctx.fill();
				ctx.strokeStyle = '#2b6ef6';
				ctx.lineWidth = 2;
				ctx.stroke();
			}
		}
	});

		// store points for interactivity
		canvas._points = points;
		canvas._predPoints = predPoints;

		// Draw hover indicator (vertical line + highlight) if hovering
		if(canvas._hoverIndex !== undefined && canvas._hoverIndex !== null) {
			const hi = canvas._hoverIndex;
			if(canvas._points[hi]) {
				const hp = canvas._points[hi];
				ctx.save();
				ctx.strokeStyle = 'rgba(0,0,0,0.12)';
				ctx.setLineDash([4,4]);
				ctx.beginPath();
				ctx.moveTo(hp.x, topPad);
				ctx.lineTo(hp.x, h - bottomPad);
				ctx.stroke();
				ctx.setLineDash([]);

				ctx.beginPath();
				ctx.arc(hp.x, hp.y, 6, 0, Math.PI * 2);
				ctx.fillStyle = '#ffffff';
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.strokeStyle = '#2b6ef6';
				ctx.stroke();
				ctx.restore();
			}
		}

	// Create DOM legend below canvas (clickable) if not present
	const parent = canvas.parentElement || canvas.parentNode;
	if(parent) {
		let legend = parent.querySelector('.canvas-legend');
		if(!legend) {
			legend = document.createElement('div');
			legend.className = 'canvas-legend';
			legend.innerHTML = `
				<span class="legend-item legend-actual" data-series="actual"><span class="legend-swatch actual"></span>Actual</span>
				<span class="legend-item legend-predicted" data-series="predicted"><span class="legend-swatch predicted"></span>Predicted</span>
				<div class="legend-tooltip" style="display:none; position:absolute;"></div>
			`;
			parent.appendChild(legend);

			// legend click handlers
			legend.querySelector('.legend-actual').addEventListener('click', () => {
				canvas._showActual = !canvas._showActual;
				drawPlantGraph(canvasId, metric, plantNum, farmingMethod);
			});
			legend.querySelector('.legend-predicted').addEventListener('click', () => {
				canvas._showPredicted = !canvas._showPredicted;
				drawPlantGraph(canvasId, metric, plantNum, farmingMethod);
			});
		}

		// Tooltip div (reuse existing in legend or create)
		let tooltip = parent.querySelector('.canvas-hover-tooltip');
		if(!tooltip) {
			tooltip = document.createElement('div');
			tooltip.className = 'canvas-hover-tooltip';
			tooltip.style.display = 'none';
			tooltip.style.position = 'absolute';
			tooltip.style.pointerEvents = 'none';
			parent.appendChild(tooltip);
		}

		// Mouse interaction for hover (show values)
		canvas.onmousemove = function(evt) {
			const rect = canvas.getBoundingClientRect();
			const mx = evt.clientX - rect.left;
			const my = evt.clientY - rect.top;
			// map mx to nearest index
			const idx = Math.round(((mx - leftPad) / plotW) * (canvas._points.length - 1));
			if(idx < 0 || idx >= canvas._points.length) {
				tooltip.style.display = 'none';
				canvas._hoverIndex = null;
				return;
			}
			const px = canvas._points[idx].x;
			const py = canvas._points[idx].y;
			const actualVal = canvas._actualData[idx];
			const predVal = canvas._predictedData[idx];

			// position tooltip near the hovered point inside the parent (.plant-graph-card)
			const parentRect = parent.getBoundingClientRect();
			// compute left relative to parent
			const leftPos = (rect.left - parentRect.left) + px + 12;
			// show tooltip first so offsetHeight is available
			tooltip.style.display = 'block';
			tooltip.style.background = '#fff';
			tooltip.style.border = '1px solid #ddd';
			tooltip.style.padding = '6px 8px';
			tooltip.style.borderRadius = '6px';
			tooltip.innerHTML = `<div style="font-weight:700;">${(canvas._dateLabels && canvas._dateLabels[idx] && canvas._dateLabels[idx].display) || ''}</div>
								<div style="color:#2b6ef6">Actual: ${actualVal.toFixed(2)}</div>
								<div style="color:#b8860b">Pred: ${predVal.toFixed(2)}</div>`;
			const tHeight = tooltip.offsetHeight || 40;
			let topPos = (rect.top - parentRect.top) + py - tHeight - 8;
			// if there's no space above the point, show below
			if(topPos < 6) topPos = (rect.top - parentRect.top) + py + 12;
			tooltip.style.left = leftPos + 'px';
			tooltip.style.top = topPos + 'px';

			canvas._hoverIndex = idx;
			// redraw to show hover vertical line
			drawPlantGraph(canvasId, metric, plantNum, farmingMethod);
		};

		canvas.onmouseout = function() {
			const tooltipEl = parent.querySelector('.canvas-hover-tooltip');
			if(tooltipEl) tooltipEl.style.display = 'none';
			canvas._hoverIndex = null;
			drawPlantGraph(canvasId, metric, plantNum, farmingMethod);
		};
	}
	
	// X-axis labels: use per-canvas date labels if available
	ctx.fillStyle = '#9aa4b8';
	ctx.font = '10px Segoe UI, Arial, sans-serif';
	ctx.textAlign = 'center';
	const labels = (canvas._dateLabels && canvas._dateLabels.map(d => d.display)) || ['Day 1','Day 2','Day 3','Day 4'];
	labels.forEach((lab, i) => {
		const x = leftPad + (i / (labels.length - 1)) * plotW;
		ctx.fillText(lab, x, h - bottomPad + 20);
	});
	
	// Y-axis label
	ctx.save();
	ctx.translate(15, h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillStyle = '#6c7380';
	ctx.font = '11px Segoe UI, Arial, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(`${info.label} (${info.unit})`, 0, 0);
	ctx.restore();
}

/* Show All modal controls */
function openShowAllModal(plantNum, farmingMethod, metric) {
	const modal = document.getElementById('showAllModal');
	const title = document.getElementById('showAllTitle');
	if(!modal || !title) return;
	title.textContent = `Plant ${plantNum} — ${metric.toUpperCase()} (${farmingMethod})`;

	const smallCanvas = document.getElementById(`plant-${plantNum}-${farmingMethod}-graph`);
	if(!smallCanvas || !smallCanvas._dateLabels) {
		showToast('No historical data available for this plant yet.', 'dangerous');
		return;
	}

	const tbody = document.querySelector('#showAllTable tbody');
	if(!tbody) return;
	tbody.innerHTML = '';

	const dateLabels = Array.isArray(smallCanvas._dateLabels) ? smallCanvas._dateLabels : [];
	const actualArr = Array.isArray(smallCanvas._actualData) ? smallCanvas._actualData : [];
	const predArr = Array.isArray(smallCanvas._predictedData) ? smallCanvas._predictedData : [];

	// Build rows for each date label (support labels as objects with display/iso or simple strings)
	dateLabels.forEach((lbl, idx) => {
		const display = (lbl && lbl.display) ? lbl.display : (typeof lbl === 'string' ? lbl : (lbl && lbl.iso ? lbl.iso : ''));
		const actualVal = (typeof actualArr[idx] !== 'undefined' && actualArr[idx] !== null) ? actualArr[idx] : '';
		const predVal = (typeof predArr[idx] !== 'undefined' && predArr[idx] !== null) ? predArr[idx] : '';

		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td style="padding:10px; border-bottom:1px solid #f0f7f0;">${display}</td>
			<td style="padding:10px; border-bottom:1px solid #f0f7f0; text-align:right;">${actualVal !== '' ? Number(actualVal).toFixed(1) : '-'}</td>
			<td style="padding:10px; border-bottom:1px solid #f0f7f0; text-align:right;">${predVal !== '' ? Number(predVal).toFixed(1) : '-'}</td>
		`;
		tbody.appendChild(tr);
	});

	modal.style.display = 'flex';
}

function closeShowAllModal() {
	const modal = document.getElementById('showAllModal');
	const tbody = document.querySelector('#showAllTable tbody');
	if(modal) modal.style.display = 'none';
	if(tbody) tbody.innerHTML = '';
}

// wire modal close buttons
setTimeout(() => {
	const closeBtn = document.getElementById('showAllClose');
	const okBtn = document.getElementById('showAllOk');
	if(closeBtn) closeBtn.addEventListener('click', closeShowAllModal);
	if(okBtn) okBtn.addEventListener('click', closeShowAllModal);
}, 500);

// Comparison Graph Functionality
let currentDays = 14;
let currentMetric = 'height';
let graphData = {
	aeroponic: [],
	dwc: [],
	traditional: [],
	dates: []
};
let graphDataCache = {}; // Cache fetched data

// Fetch real growth data from API
async function fetchGrowthData(days, metric) {
	const cacheKey = `${days}-${metric}`;
	if (graphDataCache[cacheKey]) {
		return graphDataCache[cacheKey];
	}
	
	try {
		const daysParam = days === 'all' ? 'all' : days;
		const res = await fetch(`${RELAY_API_URL}/growth-comparison?metric=${metric}&days=${daysParam}`);
		if (!res.ok) throw new Error('API error');
		const data = await res.json();
		
		if (data.success && data.dates && data.dates.length > 0) {
			// Convert nulls to interpolated values or 0
			const fillGaps = (arr) => arr.map((v, i, a) => {
				if (v !== null) return v;
				// Find nearest non-null values
				let prev = null, next = null;
				for (let j = i - 1; j >= 0; j--) if (a[j] !== null) { prev = a[j]; break; }
				for (let j = i + 1; j < a.length; j++) if (a[j] !== null) { next = a[j]; break; }
				if (prev !== null && next !== null) return (prev + next) / 2;
				if (prev !== null) return prev;
				if (next !== null) return next;
				return 0;
			});
			
			const result = {
				aeroponic: fillGaps(data.aeroponic || []),
				dwc: fillGaps(data.dwc || []),
				traditional: fillGaps(data.traditional || []),
				dates: data.dates || [],
				hasRealData: true
			};
			graphDataCache[cacheKey] = result;
			return result;
		}
	} catch (e) {
		console.log('[GrowthComparison] API fetch failed, using mock data:', e.message);
	}
	
	// Fallback to generated mock data if no real data
	return generateMockGraphData(days, metric);
}

function generateMockGraphData(days, metric) {
	const points = typeof days === 'number' ? Math.min(days * 4, 120) : 120;


	// Pick base values per metric to simulate different scales
	const metricBases = {
		height: { aero: 50, dwc: 45, trad: 40, unit: 'cm' },
		width: { aero: 30, dwc: 28, trad: 26, unit: 'cm' },
		length: { aero: 40, dwc: 36, trad: 34, unit: 'cm' },
		leaves: { aero: 20, dwc: 16, trad: 12, unit: 'count' },
		branches: { aero: 6, dwc: 5, trad: 4, unit: 'count' }
	};

	const m = metricBases[metric] || metricBases.height;

	// Aeroponic - fastest growth, highest values
	const aeroponicBase = m.aero;
	const aeroponicData = window.randomWalk(points, aeroponicBase, 8)
		.map((v, i) => Math.max(30, Math.min(100, v + (i / points) * 15)));
	
	// Deep Water Culture - medium growth
	const dwcBase = 45;
	const dwcData = window.randomWalk(points, dwcBase, 7)
		.map((v, i) => Math.max(25, Math.min(90, v + (i / points) * 12)));
	
	// Traditional - slowest growth
	const traditionalBase = m.trad;
	const traditionalData = window.randomWalk(points, traditionalBase, 6)
		.map((v, i) => Math.max(20, Math.min(80, v + (i / points) * 10)));
	
	return {
		aeroponic: aeroponicData,
		dwc: dwcData,
		traditional: traditionalData,
		dates: [],
		hasRealData: false
	};
}

async function drawComparisonGraph() {
	const canvas = document.getElementById('comparisonGraph');
	if(!canvas || !canvas.getContext) return;
	
	const container = canvas.parentElement;
	if(!container) return;
	
	const containerRect = container.getBoundingClientRect();
	// If the container is not visible (width/height 0 because tab hidden), retry shortly
	if ((containerRect.width || 0) < 120 || (containerRect.height || 0) < 80) {
		setTimeout(drawComparisonGraph, 250);
		return;
	}
	const containerWidth = containerRect.width - 40; // Account for padding
	const containerHeight = containerRect.height - 40;
	
	canvas.width = containerWidth;
	canvas.height = containerHeight;
	
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	
	const w = canvas.width, h = canvas.height;
	ctx.clearRect(0, 0, w, h);
	
	const leftPad = 60, rightPad = 30, topPad = 20, bottomPad = 50;
	const plotW = w - leftPad - rightPad;
	const plotH = h - topPad - bottomPad;
	
	// Fetch real data from API (falls back to mock if no data)
	const data = await fetchGrowthData(currentDays, currentMetric);
	graphData = data;
	
	// Check if we have any data to display
	const allValues = [...(data.aeroponic || []), ...(data.dwc || []), ...(data.traditional || [])].filter(v => v !== null && v !== undefined);
	
	if (allValues.length === 0) {
		// No data - show message
		ctx.fillStyle = '#888';
		ctx.font = '16px Poppins, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('No growth data yet. Submit plant measurements in Training tab.', w/2, h/2);
		return;
	}
	
	// Find min and max for scaling
	const min = Math.min(...allValues);
	const max = Math.max(...allValues);
	const range = max - min || 1;

	// helper: convert hex to rgba string
	function hexToRgba(hex, a){
		const h = hex.replace('#','');
		const r = parseInt(h.substring(0,2),16);
		const g = parseInt(h.substring(2,4),16);
		const b = parseInt(h.substring(4,6),16);
		return `rgba(${r}, ${g}, ${b}, ${a})`;
	}
	
	// Draw grid lines (soft, dashed horizontal lines)
	ctx.lineWidth = 1;
	ctx.setLineDash([6,6]);
	for(let i = 0; i <= 5; i++) {
		const y = topPad + (i / 5) * plotH;
		ctx.beginPath();
		ctx.moveTo(leftPad, y);
		ctx.lineTo(w - rightPad, y);
		ctx.strokeStyle = hexToRgba('#cbd6df', 1);
		ctx.stroke();

		// Y-axis labels for each grid line
		const val = (max - (i / 5) * range);
		ctx.fillStyle = '#6c7380';
		ctx.font = '12px Poppins, sans-serif';
		ctx.textAlign = 'right';
		ctx.fillText(val.toFixed(1), leftPad - 12, y + 4);
	}

	ctx.setLineDash([]);
	// vertical faint separators
	for(let i = 0; i <= 5; i++){
		const x = leftPad + (i / 5) * plotW;
		ctx.beginPath();
		ctx.moveTo(x, topPad);
		ctx.lineTo(x, h - bottomPad);
		ctx.strokeStyle = hexToRgba('#eef3f7', 1);
		ctx.stroke();
	}
	
	// Draw lines for each method
	const methods = [
		{ data: data.aeroponic || [], color: '#4CAF50', name: 'Aeroponic' },
		{ data: data.dwc || [], color: '#2196F3', name: 'Deep Water Culture' },
		{ data: data.traditional || [], color: '#FF9800', name: 'Traditional' }
	];
	
	methods.forEach(method => {
		// Skip if no data for this method
		if (!method.data || method.data.length === 0) return;
		
		const points = [];
		method.data.forEach((val, i) => {
			if (val === null || val === undefined) return;
			const x = leftPad + (i / Math.max(method.data.length - 1, 1)) * plotW;
			const y = topPad + (1 - (val - min) / range) * plotH;
			points.push({ x, y, val });
		});
		
		if (points.length < 2) return; // Need at least 2 points to draw a line
		
		// Draw gradient fill using rgba
		const gradient = ctx.createLinearGradient(0, topPad, 0, h - bottomPad);
		gradient.addColorStop(0, hexToRgba(method.color, 0.18));
		gradient.addColorStop(0.6, hexToRgba(method.color, 0.08));
		gradient.addColorStop(1, hexToRgba(method.color, 0.02));

		ctx.beginPath();
		points.forEach((point, i) => {
			if(i === 0) ctx.moveTo(point.x, point.y);
			else {
				const prevPoint = points[i - 1];
				const cpX = (prevPoint.x + point.x) / 2;
				const cpY = (prevPoint.y + point.y) / 2;
				ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
			}
		});
		ctx.lineTo(points[points.length - 1].x, h - bottomPad);
		ctx.lineTo(points[0].x, h - bottomPad);
		ctx.closePath();
		ctx.fillStyle = gradient;
		ctx.fill();

		// Draw smoothed line with soft shadow
		ctx.beginPath();
		points.forEach((point, i) => {
			if(i === 0) ctx.moveTo(point.x, point.y);
			else {
				const prevPoint = points[i - 1];
				const cpX = (prevPoint.x + point.x) / 2;
				const cpY = (prevPoint.y + point.y) / 2;
				ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
			}
		});

		ctx.strokeStyle = method.color;
		ctx.lineWidth = 3.5;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = hexToRgba(method.color, 0.18);
		ctx.shadowBlur = 18;
		ctx.stroke();
		ctx.shadowBlur = 0;
		
		// Store points for hover detection
		method.points = points;
	});
	
	// Draw data points at key positions with glow and white center
	methods.forEach(method => {
		method.points.forEach((point, i) => {
			if(i % Math.ceil(method.points.length / 8) === 0 || i === method.points.length - 1) {
				// outer glow
				ctx.beginPath();
				ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
				ctx.fillStyle = hexToRgba(method.color, 0.12);
				ctx.fill();

				// white center
				ctx.beginPath();
				ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
				ctx.fillStyle = '#ffffff';
				ctx.fill();

				// colored ring
				ctx.beginPath();
				ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
				ctx.strokeStyle = method.color;
				ctx.lineWidth = 2;
				ctx.stroke();
			}
		});
	});
	
	// X-axis labels
	ctx.fillStyle = '#6c7380';
	ctx.font = '11px Poppins, sans-serif';
	ctx.textAlign = 'center';
	const numLabels = 5;
	for(let i = 0; i <= numLabels; i++) {
		const x = leftPad + (i / numLabels) * plotW;
		const day = Math.round((i / numLabels) * currentDays);
		ctx.fillText(`Day ${day}`, x, h - bottomPad + 20);
	}
	
	// Y-axis label (based on metric)
	const metricLabels = { height: 'Height', width: 'Weight', length: 'Length', leaves: 'No. of Leaves', branches: 'No. of Branches' };
	const unitMap = { height: (data && data.unit) ? data.unit : 'units' };
	const yLabel = metricLabels[currentMetric] || 'Value';
	ctx.save();
	ctx.translate(20, h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillStyle = '#6c7380';
	ctx.font = '12px Poppins, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText(yLabel, 0, 0);
	ctx.restore();
	
	// Store methods for hover detection
	canvas._graphMethods = methods;
	canvas._graphBounds = { leftPad, rightPad, topPad, bottomPad, plotW, plotH, min, max, range };
}

// Hover tooltip functionality
function setupGraphHover() {
	const canvas = document.getElementById('comparisonGraph');
	const tooltip = document.getElementById('graphTooltip');
	if(!canvas || !tooltip) return;
	
	canvas.addEventListener('mousemove', (e) => {
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		
		const methods = canvas._graphMethods;
		const bounds = canvas._graphBounds;
		if(!methods || !bounds) return;
		
		// Find closest point on any line
		let closestPoint = null;
		let closestDistance = Infinity;
		let closestMethod = null;
		
		methods.forEach(method => {
			method.points.forEach(point => {
				const distance = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
				if(distance < closestDistance && distance < 20) {
					closestDistance = distance;
					closestPoint = point;
					closestMethod = method;
				}
			});
		});
		
		if(closestPoint && closestMethod) {
			tooltip.innerHTML = `
				<div class="tooltip-title">${closestMethod.name}</div>
				<div class="tooltip-value">
					<span class="tooltip-method" style="background: ${closestMethod.color};"></span>
					${Math.round(closestPoint.val)}%
				</div>
			`;
			tooltip.classList.add('show');
			
			// Position tooltip
			const tooltipRect = tooltip.getBoundingClientRect();
			let tooltipX = e.clientX - rect.left + 15;
			let tooltipY = e.clientY - rect.top - tooltipRect.height / 2;
			
			if(tooltipX + tooltipRect.width > rect.width) {
				tooltipX = e.clientX - rect.left - tooltipRect.width - 15;
			}
			if(tooltipY < 0) tooltipY = 10;
			if(tooltipY + tooltipRect.height > rect.height) {
				tooltipY = rect.height - tooltipRect.height - 10;
			}
			
			tooltip.style.left = tooltipX + 'px';
			tooltip.style.top = tooltipY + 'px';
		} else {
			tooltip.classList.remove('show');
		}
	});
	

};

// Draw sensor reading graphs with beautiful modern design
function drawSensorGraph(canvasId, sensorType) {
	const canvas = document.getElementById(canvasId);
	if(!canvas) return;
	
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	
	const rect = canvas.getBoundingClientRect();
	canvas.width = rect.width;
	canvas.height = rect.height;
	
	const w = canvas.width;
	const h = canvas.height;
	
	const leftPad = 55, rightPad = 25, topPad = 25, bottomPad = 45;
	const plotW = w - leftPad - rightPad;
	const plotH = h - topPad - bottomPad;
	
	// Enhanced sensor-specific configurations with vibrant gradients
	const sensorConfig = {
		ph: { 
			base: 6.5, range: 0.5, unit: 'pH', 
			color: '#10b981', 
			gradientStart: '#34d399',
			gradientEnd: '#059669',
			fillGradientStart: 'rgba(16, 185, 129, 0.3)',
			fillGradientEnd: 'rgba(16, 185, 129, 0.02)'
		},
		do: { 
			base: 8.0, range: 1.0, unit: 'mg/L', 
			color: '#3b82f6',
			gradientStart: '#60a5fa',
			gradientEnd: '#2563eb',
			fillGradientStart: 'rgba(59, 130, 246, 0.3)',
			fillGradientEnd: 'rgba(59, 130, 246, 0.02)'
		},
		tds: { 
			base: 1200, range: 200, unit: 'ppm', 
			color: '#f59e0b',
			gradientStart: '#fbbf24',
			gradientEnd: '#d97706',
			fillGradientStart: 'rgba(245, 158, 11, 0.3)',
			fillGradientEnd: 'rgba(245, 158, 11, 0.02)'
		},
		temp: { 
			base: 25, range: 3, unit: '°C', 
			color: '#ef4444',
			gradientStart: '#f87171',
			gradientEnd: '#dc2626',
			fillGradientStart: 'rgba(239, 68, 68, 0.3)',
			fillGradientEnd: 'rgba(239, 68, 68, 0.02)'
		},
		hum: { 
			base: 70, range: 10, unit: '%', 
			color: '#8b5cf6',
			gradientStart: '#a78bfa',
			gradientEnd: '#7c3aed',
			fillGradientStart: 'rgba(139, 92, 246, 0.3)',
			fillGradientEnd: 'rgba(139, 92, 246, 0.02)'
		}
	};
	
	const config = sensorConfig[sensorType] || sensorConfig.ph;

	// Prefer live series if available; otherwise generate demo data
	let series = Array.isArray(window.sensorSeries?.[sensorType]) ? window.sensorSeries[sensorType] : [];
	let data = [];
	let times = [];
	if(series && series.length >= 4){
		// Use the recorded time series
		const startIdx = Math.max(0, series.length - 48);
		for(let i = startIdx; i < series.length; i++){
			data.push(series[i].v);
			times.push(new Date(series[i].t));
		}
	} else {
		// Fallback: demo data with smooth variation
		const dataPoints = 30;
		const now = new Date();
		for(let i = 0; i < dataPoints; i++) {
			const time = new Date(now.getTime() - (dataPoints - i - 1) * 1200000);
			times.push(time);
			const variation = Math.sin(i * 0.3) * config.range * 0.6;
			const value = config.base + variation + (Math.random() - 0.5) * config.range * 0.4;
			data.push(value);
		}
	}
	
	const minVal = Math.min(...data) - config.range * 0.15;
	const maxVal = Math.max(...data) + config.range * 0.15;
	const range = maxVal - minVal || 1;
	
	// Clear with elegant background gradient
	const bgGradient = ctx.createLinearGradient(0, 0, 0, h);
	bgGradient.addColorStop(0, '#f8fafc');
	bgGradient.addColorStop(1, '#ffffff');
	ctx.fillStyle = bgGradient;
	ctx.fillRect(0, 0, w, h);
	
	// Draw subtle grid lines with dashed style
	ctx.strokeStyle = '#e2e8f0';
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	for(let i = 0; i <= 5; i++) {
		const y = topPad + (i / 5) * plotH;
		ctx.beginPath();
		ctx.moveTo(leftPad, y);
		ctx.lineTo(leftPad + plotW, y);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	
	// Draw Y axis labels with modern styling
	ctx.fillStyle = '#64748b';
	ctx.font = '600 11px Poppins, sans-serif';
	ctx.textAlign = 'right';
	for(let i = 0; i <= 5; i++) {
		const val = maxVal - (i / 5) * range;
		const y = topPad + (i / 5) * plotH;
		ctx.fillText(val.toFixed(1), leftPad - 12, y + 4);
	}
	
	// Create smooth bezier curve points
	const points = [];
	for(let i = 0; i < data.length; i++) {
		const x = leftPad + (i / (data.length - 1)) * plotW;
		const y = topPad + plotH - ((data[i] - minVal) / range) * plotH;
		points.push({x, y, val: data[i]});
	}
	
	// Draw gradient fill area with smooth curves
	const fillGradient = ctx.createLinearGradient(0, topPad, 0, topPad + plotH);
	fillGradient.addColorStop(0, config.fillGradientStart);
	fillGradient.addColorStop(1, config.fillGradientEnd);
	
	ctx.beginPath();
	points.forEach((point, i) => {
		if(i === 0) {
			ctx.moveTo(point.x, point.y);
		} else {
			const prevPoint = points[i - 1];
			const cpX = (prevPoint.x + point.x) / 2;
			const cpY = (prevPoint.y + point.y) / 2;
			ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
		}
	});
	if(points.length > 0) {
		ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y,
			points[points.length - 1].x, points[points.length - 1].y);
		ctx.lineTo(points[points.length - 1].x, topPad + plotH);
		ctx.lineTo(points[0].x, topPad + plotH);
		ctx.closePath();
	}
	ctx.fillStyle = fillGradient;
	ctx.fill();
	
	// Draw smooth line with gradient and glow
	const lineGradient = ctx.createLinearGradient(leftPad, 0, leftPad + plotW, 0);
	lineGradient.addColorStop(0, config.gradientStart);
	lineGradient.addColorStop(0.5, config.color);
	lineGradient.addColorStop(1, config.gradientEnd);
	
	ctx.beginPath();
	points.forEach((point, i) => {
		if(i === 0) {
			ctx.moveTo(point.x, point.y);
		} else {
			const prevPoint = points[i - 1];
			const cpX = (prevPoint.x + point.x) / 2;
			const cpY = (prevPoint.y + point.y) / 2;
			ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
		}
	});
	if(points.length > 0) {
		ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y,
			points[points.length - 1].x, points[points.length - 1].y);
	}
	
	ctx.strokeStyle = lineGradient;
	ctx.lineWidth = 3.5;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.shadowColor = config.color;
	ctx.shadowBlur = 12;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 2;
	ctx.stroke();
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
	
	// Draw elegant data points
	points.forEach((point, i) => {
		if(i % Math.ceil(points.length / 8) === 0 || i === points.length - 1) {
			// Outer glow
			ctx.beginPath();
			ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
			ctx.fillStyle = config.color + '30';
			ctx.fill();
			
			// Main point
			ctx.beginPath();
			ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
			ctx.fillStyle = '#ffffff';
			ctx.fill();
			ctx.strokeStyle = config.color;
			ctx.lineWidth = 2.5;
			ctx.stroke();
		}
	});
	
	// Draw X axis labels (time) with modern styling
	ctx.fillStyle = '#64748b';
	ctx.font = '600 10px Poppins, sans-serif';
	ctx.textAlign = 'center';
	const timeSteps = Math.min(6, times.length - 1);
	for(let i = 0; i <= timeSteps; i++) {
		const idx = Math.floor((i / timeSteps) * (times.length - 1));
		const time = times[idx];
		const x = leftPad + (i / timeSteps) * plotW;
		const label = time.getHours().toString().padStart(2, '0') + ':' + 
					  time.getMinutes().toString().padStart(2, '0');
		ctx.fillText(label, x, topPad + plotH + 22);
	}
	
	// Draw axis title labels
	ctx.fillStyle = '#475569';
	ctx.font = '600 12px Poppins, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText('Time', leftPad + plotW / 2, h - 8);
	
	ctx.save();
	ctx.translate(18, topPad + plotH / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText(config.unit, 0, 0);
	ctx.restore();
}

// Initialize sensor graphs when sensor tab is opened
document.querySelectorAll('[data-tab]').forEach(tab => {
	tab.addEventListener('click', (e) => {
		const tabName = tab.getAttribute('data-tab');
		if(tabName === 'sensors') {
			setTimeout(() => {
				drawSensorGraph('sensorGraph-ph', 'ph');
				drawSensorGraph('sensorGraph-do', 'do');
				drawSensorGraph('sensorGraph-tds', 'tds');
				drawSensorGraph('sensorGraph-temp', 'temp');
				drawSensorGraph('sensorGraph-hum', 'hum');
			}, 100);
		}
	});
});

// Farming method tab navigation functions
function showAeroponics() {
	// Update tab active state
	const tabAero = document.getElementById('tab-aero');
	const tabDwc = document.getElementById('tab-dwc');
	const farmingBtnAero = document.querySelector('[data-method="aeroponics"]');
	const farmingBtnDwc = document.querySelector('[data-method="dwc"]');
	
	if(tabAero) tabAero.classList.add('active');
	if(tabDwc) tabDwc.classList.remove('active');
	if(farmingBtnAero) farmingBtnAero.classList.add('active');
	if(farmingBtnDwc) farmingBtnDwc.classList.remove('active');
	
	// Update containers
	const aeroContainer = document.getElementById('aeroponicsContainer');
	const dwcContainer = document.getElementById('dwcContainer');
	
	if(aeroContainer) aeroContainer.style.display = 'block';
	if(dwcContainer) dwcContainer.style.display = 'none';
	
	// Store selected method
	window.selectedFarmingMethod = 'aeroponics';
	
	// Regenerate graphs with current metric
	const activeMetricBtn = document.querySelector('.metric-btn.active');
	const metric = activeMetricBtn ? activeMetricBtn.getAttribute('data-metric') : 'height';
	generatePlantGraphs(metric, 'aeroponics');
}

function showDWC() {
	// Update tab active state
	const tabAero = document.getElementById('tab-aero');
	const tabDwc = document.getElementById('tab-dwc');
	const farmingBtnAero = document.querySelector('[data-method="aeroponics"]');
	const farmingBtnDwc = document.querySelector('[data-method="dwc"]');
	
	if(tabAero) tabAero.classList.remove('active');
	if(tabDwc) tabDwc.classList.add('active');
	if(farmingBtnAero) farmingBtnAero.classList.remove('active');
	if(farmingBtnDwc) farmingBtnDwc.classList.add('active');
	
	// Update containers
	const aeroContainer = document.getElementById('aeroponicsContainer');
	const dwcContainer = document.getElementById('dwcContainer');
	
	if(aeroContainer) aeroContainer.style.display = 'none';
	if(dwcContainer) dwcContainer.style.display = 'block';
	
	// Store selected method
	window.selectedFarmingMethod = 'dwc';
	
	// Regenerate graphs with current metric
	const activeMetricBtn = document.querySelector('.metric-btn.active');
	const metric = activeMetricBtn ? activeMetricBtn.getAttribute('data-metric') : 'height';
	generatePlantGraphs(metric, 'dwc');
}

// Theme Toggle Functionality
function initThemeToggle() {
	const themeToggle = document.getElementById('themeToggle');
	const html = document.documentElement;
	
	// Get saved theme from localStorage or default to 'glass'
	const savedTheme = localStorage.getItem('sboltech-theme') || 'glass';
	html.setAttribute('data-theme', savedTheme);
	updateThemeIcon(savedTheme);
	
	// Theme toggle click handler
	if(themeToggle) {
		themeToggle.addEventListener('click', () => {
			const currentTheme = html.getAttribute('data-theme');
			const newTheme = currentTheme === 'glass' ? 'original' : 'glass';
			
			html.setAttribute('data-theme', newTheme);
			localStorage.setItem('sboltech-theme', newTheme);
			updateThemeIcon(newTheme);
		});
	}
}

function updateThemeIcon(theme) {
	const themeToggle = document.getElementById('themeToggle');
	if(themeToggle) {
		const icon = themeToggle.querySelector('.theme-icon');
		icon.textContent = theme === 'glass' ? '☀️' : '🌙';
	}
}

// Initialize theme toggle on page load
initThemeToggle();


// Populate elements with class 'readingvoltage' with a random voltage (mV)
function populateRandomVoltages() {
	const els = document.querySelectorAll('.readingvoltage');
	if (!els || els.length === 0) return;
	els.forEach(el => {
		const min = parseFloat(el.dataset.min) || 200; // default min mV
		const max = parseFloat(el.dataset.max) || 1200; // default max mV
		const val = Math.random() * (max - min) + min;
		const formatted = val >= 100 ? val.toFixed(0) : val.toFixed(2);
		if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = formatted;
		else el.textContent = formatted + ' mV';
	});
}

document.addEventListener('DOMContentLoaded', () => {
	populateRandomVoltages();
});

// --- Growth State Chart (averages of 6 plants per method) ---
function getAverageForMethod(methodContainerId, field) {
	const selector = `#${methodContainerId} .sensor-input1[data-field="${field}"]`;
	const inputs = document.querySelectorAll(selector);
	if(!inputs || inputs.length === 0) return 0;
	let sum = 0, count = 0;
	inputs.forEach(i => {
		const val = parseFloat(i.value);
		if(!Number.isNaN(val)) { sum += val; count++; }
	});
	return count > 0 ? (sum / count) : 0;
}

function computeAverages() {
	// order: Height, Weight (mapped to width), Length, No. of Leaves, No. of Branches
	const metrics = ['height','width','length','leaves','branches'];
	const methods = [
		{ id: 'aeroponicsParams', label: 'Aeroponics' },
		{ id: 'dwcParams', label: 'DWC' },
		{ id: 'traditionalParams', label: 'Traditional' }
	];

	const results = methods.map(m => {
		return metrics.map(metric => {
			return Number(parseFloat(getAverageForMethod(m.id, metric)).toFixed(2));
		});
	});
	return { labels: ['Height','Weight','Length','No. of Leaves','No. of Branches'], datasets: results };
}

let growthChartInstance = null;
function setupGrowthChart() {
	const ctx = document.getElementById('growthStateChart');
	if(!ctx) return;

	const data = computeAverages();
	const colors = ['#4CAF50','#2196F3','#FF9800'];
	const methodLabels = ['Aeroponics','DWC','Traditional'];

	const ctx2d = ctx.getContext('2d');
	const datasets = data.datasets.map((arr, idx) => {
		// create a soft vertical gradient for the filled area
		const g = ctx2d.createLinearGradient(0, 0, 0, 360);
		g.addColorStop(0, colors[idx] + '22');
		g.addColorStop(0.6, colors[idx] + '12');
		g.addColorStop(1, colors[idx] + '04');

		return {
			label: methodLabels[idx],
			data: arr,
			borderColor: colors[idx],
			backgroundColor: g,
			tension: 0.35,
			fill: true,
			pointRadius: 6,
			pointBackgroundColor: '#ffffff',
			pointBorderColor: colors[idx],
			borderWidth: 2
		};
	});

	if(growthChartInstance) {
		growthChartInstance.data.labels = data.labels;
		growthChartInstance.data.datasets = datasets;
		growthChartInstance.update();
		return;
	}

	growthChartInstance = new Chart(ctx2d, {
		type: 'line',
		data: { labels: data.labels, datasets },
		options: {
			responsive: true,
			maintainAspectRatio: false,
			interaction: { mode: 'index', intersect: false },
			scales: {
				y: {
					beginAtZero: false,
					grid: { color: 'rgba(0,0,0,0.04)', borderDash: [6,6] },
					ticks: { color: '#4b5c3a', font: { weight: 600 } }
				},
				x: { grid: { display: false }, ticks: { color: '#3b7a2a', font: { weight: 600 } } }
			},
			plugins: {
				legend: { position: 'top', labels: { usePointStyle: true, padding: 12 } },
				tooltip: {
					enabled: true,
					backgroundColor: '#ffffff',
					titleColor: '#2f4f2f',
					bodyColor: '#28402a',
					borderColor: 'rgba(0,0,0,0.06)',
					borderWidth: 1,
					boxPadding: 6,
					callbacks: {
						label: function(context) {
							const label = context.dataset.label || '';
							const value = context.formattedValue;
							return label + ': ' + value;
						}
					}
				}
			}
		}
	});

	// Auto-update when training inputs change
	const inputSelector = '#aeroponicsParams .sensor-input1, #dwcParams .sensor-input1, #traditionalParams .sensor-input1';
	document.querySelectorAll(inputSelector).forEach(inp => {
		inp.addEventListener('input', () => {
			const updated = computeAverages();
			growthChartInstance.data.datasets.forEach((ds, i) => ds.data = updated.datasets[i]);
			growthChartInstance.update();
		});
	});

	// Refresh button
	const refreshBtn = document.getElementById('refreshGrowthChart');
	if(refreshBtn) refreshBtn.addEventListener('click', () => setupGrowthChart());
}

// initialize chart after DOM ready
document.addEventListener('DOMContentLoaded', () => {
	setupGrowthChart();
	// build the small metric charts grid
	buildMetricMiniCharts();
});

// --- Mini metric charts (per-metric, show values for 6 plants per method) ---
const miniCharts = {};
function getPerPlantValues(methodId, field){
	const selector = `#${methodId} .sensor-input1[data-field="${field}"]`;
	const inputs = document.querySelectorAll(selector);
	const vals = [];
	inputs.forEach(i => {
		const v = parseFloat(i.value);
		vals.push(Number.isFinite(v) ? v : 0);
	});
	// ensure length 6
	while(vals.length < 6) vals.push(0);
	return vals.slice(0,6);
}

function buildMetricMiniCharts(){
	const metrics = [
		{ id: 'height', label: 'Height' },
		{ id: 'width', label: 'Weight' },
		{ id: 'length', label: 'Length' },
		{ id: 'leaves', label: 'No. of Leaves' },
		{ id: 'branches', label: 'No. of Branches' }
	];

	const methods = [ {id:'aeroponicsParams', label:'Aeroponics', color:'#4CAF50'}, {id:'dwcParams', label:'DWC', color:'#2196F3'}, {id:'traditionalParams', label:'Traditional', color:'#FF9800'} ];

	metrics.forEach(metric => {
		const ctx = document.getElementById(`mini-chart-${metric.id}`);
		if(!ctx) return;
		const labels = ['P1','P2','P3','P4','P5','P6'];
		const datasets = methods.map(m => ({
			label: m.label,
			data: getPerPlantValues(m.id, metric.id),
			borderColor: m.color,
			backgroundColor: m.color + '22',
			tension: 0.4,
			fill: true,
			pointRadius: 4,
			pointBackgroundColor: '#fff',
			borderWidth: 2
		}));

		miniCharts[metric.id] = new Chart(ctx.getContext('2d'), {
			type: 'line',
			data: { labels, datasets },
			options: { responsive: true, maintainAspectRatio: false, scales:{ y:{ beginAtZero: false, ticks:{ color:'#4b5c3a' } }, x:{ ticks:{ color:'#3b7a2a' } } }, plugins:{ legend:{ display:true, position:'top', labels:{boxWidth:10} } } }
		});
	});

	// Overview chart: averages per metric per method
	const overviewCtx = document.getElementById('mini-chart-overview');
	if(overviewCtx){
		const avg = computeAverages(); // returns labels and datasets (three arrays)
		const labels = avg.labels;
		const colors = ['#4CAF50','#2196F3','#FF9800'];
		const methodLabels = ['Aeroponics','DWC','Traditional'];
		const datasets = avg.datasets.map((arr, idx) => ({ label: methodLabels[idx], data: arr, borderColor: colors[idx], backgroundColor: colors[idx] + '22', tension:0.35, fill:true, pointRadius:4, pointBackgroundColor:'#fff' }));
		miniCharts['overview'] = new Chart(overviewCtx.getContext('2d'), { type:'line', data:{labels,datasets}, options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ beginAtZero:false, ticks:{ color:'#4b5c3a' } }, x:{ ticks:{ color:'#3b7a2a' } } }, plugins:{ legend:{ display:true, position:'top' } } } });
	}

	// Wire input updates to refresh mini charts
	const inputSelector = '#aeroponicsParams .sensor-input1, #dwcParams .sensor-input1, #traditionalParams .sensor-input1';
	document.querySelectorAll(inputSelector).forEach(inp => {
		inp.addEventListener('input', () => updateMiniCharts());
	});
}

function updateMiniCharts(){
	const metrics = ['height','width','length','leaves','branches'];
	const methods = [ {id:'aeroponicsParams'}, {id:'dwcParams'}, {id:'traditionalParams'} ];
	metrics.forEach(metric => {
		const chart = miniCharts[metric];
		if(!chart) return;
		chart.data.datasets.forEach((ds, idx) => {
			ds.data = getPerPlantValues(methods[idx].id, metric);
		});
		chart.update();
	});
	// overview
	if(miniCharts['overview']){
		const avg = computeAverages();
		miniCharts['overview'].data.datasets.forEach((ds, i) => ds.data = avg.datasets[i]);
		miniCharts['overview'].update();
	}
}



// ==================== FULL CALIBRATION SYSTEM ====================
(function initCalibrationSystem() {
    // Use dynamic RELAY_API_URL (auto-detected from page origin)
    const getApiUrl = () => RELAY_API_URL || (window.location.origin + '/api');
    
    // pH buffer values
    const phBuffers = [4.00, 6.86, 9.18];
    
    // DO saturation table (mg/L at 100% saturation by temperature in °C)
    const doSaturationTable = {
        0: 14.62, 5: 12.77, 10: 11.29, 15: 10.08, 20: 9.09,
        21: 8.91, 22: 8.74, 23: 8.58, 24: 8.42, 25: 8.26,
        26: 8.11, 27: 7.97, 28: 7.83, 29: 7.69, 30: 7.56,
        35: 6.95, 40: 6.41
    };
    
    function getDOSaturation(tempC) {
        const temps = Object.keys(doSaturationTable).map(Number).sort((a,b) => a-b);
        if (tempC <= temps[0]) return doSaturationTable[temps[0]];
        if (tempC >= temps[temps.length-1]) return doSaturationTable[temps[temps.length-1]];
        for (let i = 0; i < temps.length - 1; i++) {
            if (tempC >= temps[i] && tempC <= temps[i+1]) {
                const t1 = temps[i], t2 = temps[i+1];
                const ratio = (tempC - t1) / (t2 - t1);
                return doSaturationTable[t1] + ratio * (doSaturationTable[t2] - doSaturationTable[t1]);
            }
        }
        return 8.26;
    }
    
    // Calibration state
    const calState = {
        ph: { voltage: null, points: [], history: [] },
        do: { voltage: null, points: [], history: [] },
        tds: { voltage: null, points: [], history: [] }
    };
    
    // Voltage smoothing - keeps last 15 readings and averages
    const VOLTAGE_HISTORY_SIZE = 15;
    const STABILITY_THRESHOLD = 20; // mV - readings must be within this range to be "stable"
    
    function smoothVoltage(sensor, newValue) {
        const state = calState[sensor];
        state.history.push(newValue);
        if (state.history.length > VOLTAGE_HISTORY_SIZE) {
            state.history.shift();
        }
        // Return average of history
        const sum = state.history.reduce((a, b) => a + b, 0);
        return sum / state.history.length;
    }
    
    // Check if voltage is stable (low variance)
    function isVoltageStable(sensor) {
        const history = calState[sensor].history;
        if (history.length < VOLTAGE_HISTORY_SIZE) return false;
        
        const min = Math.min(...history);
        const max = Math.max(...history);
        const rangeInMv = (max - min) * 1000;
        
        return rangeInMv <= STABILITY_THRESHOLD;
    }
    
    // Get stability percentage (0-100)
    function getStabilityPercent(sensor) {
        const history = calState[sensor].history;
        if (history.length < 3) return 0;
        
        const min = Math.min(...history);
        const max = Math.max(...history);
        const rangeInMv = (max - min) * 1000;
        
        // Convert range to percentage (smaller range = more stable)
        // 0mV = 100%, 20mV+ = 0%
        const stability = Math.max(0, 100 - (rangeInMv * 5));
        return Math.round(stability);
    }
    
    // Load current calibration from API or Firebase
    async function loadCalibration() {
        if (isStaticHosting()) {
            // Read from Firebase calibration data (set by onSnapshot listener)
            const apply = () => {
                const cal = window.firebaseCalibration;
                if (!cal) return;
                for (const sensor of ['ph', 'do', 'tds']) {
                    if (cal[sensor]) {
                        const slopeEl = document.getElementById(`${sensor}CurrentSlope`);
                        const offsetEl = document.getElementById(`${sensor}CurrentOffset`);
                        const badge = document.getElementById(`${sensor}CalStatus`);
                        if (slopeEl) slopeEl.textContent = cal[sensor].slope?.toFixed(4) || '--';
                        if (offsetEl) offsetEl.textContent = cal[sensor].offset?.toFixed(4) || '--';
                        if (badge && cal[sensor].slope !== 1) {
                            badge.textContent = 'Calibrated';
                            badge.classList.add('calibrated');
                        }
                    }
                }
            };
            // Try immediately, then poll until Firebase data arrives
            if (window.firebaseCalibration) { apply(); return; }
            const poll = setInterval(() => {
                if (window.firebaseCalibration) { apply(); clearInterval(poll); }
            }, 1000);
            setTimeout(() => clearInterval(poll), 30000);
            return;
        }
        
        try {
            const res = await fetch(`${getApiUrl()}/calibration`);
            const data = await res.json();
            
            for (const sensor of ['ph', 'do', 'tds']) {
                if (data[sensor]) {
                    const slopeEl = document.getElementById(`${sensor}CurrentSlope`);
                    const offsetEl = document.getElementById(`${sensor}CurrentOffset`);
                    const badge = document.getElementById(`${sensor}CalStatus`);
                    
                    if (slopeEl) slopeEl.textContent = data[sensor].slope?.toFixed(4) || '--';
                    if (offsetEl) offsetEl.textContent = data[sensor].offset?.toFixed(4) || '--';
                    if (badge && data[sensor].slope !== 1) {
                        badge.textContent = 'Calibrated';
                        badge.classList.add('calibrated');
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load calibration:', e);
        }
    }
    
    // Fetch live voltage readings
    async function fetchVoltage() {
        let data = {};
        
        if (isStaticHosting()) {
            // Read voltage from Firebase latest sensor data
            const sensorData = window.latestSensorData;
            if (!sensorData) return;
            
            // Map Firebase sensor keys to calibration sensor names
            const voltageMap = {
                ph: sensorData.ph?.raw_voltage,
                do: sensorData.do_mg_l?.raw_voltage,
                tds: sensorData.tds_ppm?.raw_voltage
            };
            
            for (const sensor of ['ph', 'do', 'tds']) {
                if (voltageMap[sensor] !== undefined && voltageMap[sensor] !== null) {
                    data[sensor] = { voltage: voltageMap[sensor] };
                }
            }
        } else {
            try {
                const res = await fetch(`${getApiUrl()}/voltage`);
                data = await res.json();
            } catch (e) {
                console.error('Failed to fetch voltage:', e);
                return;
            }
        }
        
        for (const sensor of ['ph', 'do', 'tds']) {
            const el = document.getElementById(`${sensor}LiveVoltage`);
            const stabilityEl = document.getElementById(`${sensor}Stability`);
            
            if (data[sensor]?.voltage !== undefined) {
                // Apply smoothing for stable display
                const smoothed = smoothVoltage(sensor, data[sensor].voltage);
                calState[sensor].voltage = smoothed;
                if (el) el.textContent = `${(smoothed * 1000).toFixed(1)} mV`;
                
                // Update stability indicator
                const stable = isVoltageStable(sensor);
                const stabilityPct = getStabilityPercent(sensor);
                
                if (stabilityEl) {
                    if (stable) {
                        stabilityEl.innerHTML = `<span style="color:#22c55e;font-weight:bold;">✓ STABLE - Ready to capture!</span>`;
                    } else {
                        const barWidth = stabilityPct;
                        const barColor = stabilityPct > 70 ? '#eab308' : '#ef4444';
                        stabilityEl.innerHTML = `
                            <span style="color:#888;">Stabilizing... ${stabilityPct}%</span>
                            <div style="width:100px;height:6px;background:#333;border-radius:3px;margin-top:4px;">
                                <div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:3px;transition:width 0.3s;"></div>
                            </div>`;
                    }
                }
            }
        }
    }
    
    // Calculate slope and offset from captured points
    function calculateCalibration(sensor) {
        const points = calState[sensor].points;
        if (points.length < 1) return null;
        
        if (points.length === 1) {
            const p = points[0];
            let slope, offset;
            
            if (sensor === 'ph') {
                // Nernst equation slope at 25°C
                slope = -0.059;
                offset = p.value - (slope * p.voltage);
            } else if (sensor === 'do') {
                // At 100% saturation
                const tempC = parseFloat(document.getElementById('doBufferTemp')?.value) || 25;
                const doSat = getDOSaturation(tempC);
                slope = doSat / p.voltage;
                offset = 0;
            } else { // tds
                slope = p.value / p.voltage;
                offset = 0;
            }
            return { slope, offset };
        }
        
        // 2+ points: linear regression
        const n = points.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        
        for (const p of points) {
            sumX += p.voltage;
            sumY += p.value;
            sumXY += p.voltage * p.value;
            sumXX += p.voltage * p.voltage;
        }
        
        const denom = n * sumXX - sumX * sumX;
        if (Math.abs(denom) < 1e-10) {
            return { slope: 1, offset: sumY / n - sumX / n };
        }
        
        const slope = (n * sumXY - sumX * sumY) / denom;
        const offset = (sumY - slope * sumX) / n;
        
        return { slope, offset };
    }
    
    // Update UI after capturing a point
    function updatePointUI(sensor, pointNum) {
        const point = calState[sensor].points.find(p => p.pointNum === pointNum);
        if (!point) return;
        
        const pointEl = document.getElementById(`${sensor}Point${pointNum}`);
        const voltageEl = document.getElementById(`${sensor}Point${pointNum}Voltage`);
        const statusEl = document.getElementById(`${sensor}Point${pointNum}Status`);
        
        if (pointEl) pointEl.classList.add('captured');
        if (voltageEl) voltageEl.textContent = (point.voltage * 1000).toFixed(1) + ' mV';
        if (statusEl) {
            statusEl.textContent = 'Captured';
            statusEl.classList.add('captured');
        }
        
        checkCalibrationReady(sensor);
    }
    
    // Check if enough points to enable Apply button
    function checkCalibrationReady(sensor) {
        const points = calState[sensor].points;
        const modeSelect = document.getElementById(`${sensor}PointMode`);
        const requiredPoints = parseInt(modeSelect?.value || '2');
        
        const applyBtn = document.getElementById(`${sensor}ApplyBtn`);
        const resultCard = document.getElementById(`${sensor}ResultCard`);
        
        // For DO and TDS, 1 point is enough
        const minPoints = sensor === 'ph' ? 2 : 1;
        
        if (points.length >= minPoints) {
            const cal = calculateCalibration(sensor);
            if (cal) {
                const slopeEl = document.getElementById(`${sensor}NewSlope`);
                const offsetEl = document.getElementById(`${sensor}NewOffset`);
                if (slopeEl) slopeEl.textContent = cal.slope.toFixed(4);
                if (offsetEl) offsetEl.textContent = cal.offset.toFixed(4);
                if (resultCard) resultCard.style.display = 'block';
                if (applyBtn) applyBtn.disabled = false;
            }
        }
    }
    
    // Save calibration to API or Firebase
    async function saveCalibration(sensor) {
        const cal = calculateCalibration(sensor);
        if (!cal) return;
        
        let success = false;
        
        // Use Firebase on static hosting (Vercel)
        if (isStaticHosting() && window.saveCalibrationFirebase) {
            success = await window.saveCalibrationFirebase(sensor, cal.slope, cal.offset);
        } else {
            // Use API when available (local)
            try {
                const res = await fetch(`${getApiUrl()}/calibration`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sensor, slope: cal.slope, offset: cal.offset })
                });
                success = res.ok;
            } catch (e) {
                console.error('Failed to save calibration:', e);
            }
        }
        
        if (success) {
            // Update current values display
            const slopeEl = document.getElementById(`${sensor}CurrentSlope`);
            const offsetEl = document.getElementById(`${sensor}CurrentOffset`);
            if (slopeEl) slopeEl.textContent = cal.slope.toFixed(4);
            if (offsetEl) offsetEl.textContent = cal.offset.toFixed(4);
            
            const badge = document.getElementById(`${sensor}CalStatus`);
            if (badge) {
                badge.textContent = 'Calibrated';
                badge.classList.add('calibrated');
            }
            
            // Show success modal
            const modal = document.getElementById('calSuccessModal');
            const msg = document.getElementById('calSuccessMsg');
            if (msg) msg.textContent = `${sensor.toUpperCase()} calibration saved!\nSlope: ${cal.slope.toFixed(4)}\nOffset: ${cal.offset.toFixed(4)}`;
            if (modal) modal.style.display = 'flex';
            
            clearCalibration(sensor);
        } else {
            alert('Failed to save calibration');
        }
    }
    
    // Clear calibration state
    function clearCalibration(sensor) {
        calState[sensor].points = [];
        
        for (let i = 1; i <= 3; i++) {
            const pointEl = document.getElementById(`${sensor}Point${i}`);
            const voltageEl = document.getElementById(`${sensor}Point${i}Voltage`);
            const statusEl = document.getElementById(`${sensor}Point${i}Status`);
            
            if (pointEl) pointEl.classList.remove('captured');
            if (voltageEl) voltageEl.textContent = '--';
            if (statusEl) {
                statusEl.textContent = 'Waiting';
                statusEl.classList.remove('captured');
            }
        }
        
        const resultCard = document.getElementById(`${sensor}ResultCard`);
        const applyBtn = document.getElementById(`${sensor}ApplyBtn`);
        
        if (resultCard) resultCard.style.display = 'none';
        if (applyBtn) applyBtn.disabled = true;
    }
    
    // Setup event listeners
    function setupEventListeners() {
        // Sensor tab switching
        document.querySelectorAll('.calibrate-header .calibrate-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const sensor = btn.dataset.sensor;
                if (!sensor || !['ph', 'do', 'tds'].includes(sensor)) return;
                
                document.querySelectorAll('.calibrate-header .calibrate-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                document.querySelectorAll('.simple-cal-panel').forEach(p => p.style.display = 'none');
                const panel = document.querySelector(`.simple-cal-panel[data-sensor-type="${sensor}"]`);
                if (panel) panel.style.display = 'block';
            });
        });
        
        // pH point mode change
        const phModeSelect = document.getElementById('phPointMode');
        if (phModeSelect) {
            phModeSelect.addEventListener('change', () => {
                const mode = parseInt(phModeSelect.value);
                const point3 = document.getElementById('phPoint3');
                if (point3) point3.style.display = mode >= 3 ? 'block' : 'none';
                clearCalibration('ph');
            });
        }
        
        // DO point mode change
        const doModeSelect = document.getElementById('doPointMode');
        if (doModeSelect) {
            doModeSelect.addEventListener('change', () => {
                const mode = parseInt(doModeSelect.value);
                const point2 = document.getElementById('doPoint2');
                if (point2) point2.style.display = mode >= 2 ? 'block' : 'none';
                clearCalibration('do');
            });
        }
        
        // TDS point mode change
        const tdsModeSelect = document.getElementById('tdsPointMode');
        if (tdsModeSelect) {
            tdsModeSelect.addEventListener('change', () => {
                const mode = parseInt(tdsModeSelect.value);
                const point2 = document.getElementById('tdsPoint2');
                if (point2) point2.style.display = mode >= 2 ? 'block' : 'none';
                clearCalibration('tds');
            });
        }
        
        // pH capture buttons
        for (let i = 1; i <= 3; i++) {
            const btn = document.getElementById(`phCapture${i}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (calState.ph.voltage === null) {
                        alert('No voltage reading available. Is the sensor connected?');
                        return;
                    }
                    
                    calState.ph.points = calState.ph.points.filter(p => p.pointNum !== i);
                    calState.ph.points.push({
                        pointNum: i,
                        value: phBuffers[i - 1],
                        voltage: calState.ph.voltage
                    });
                    
                    updatePointUI('ph', i);
                });
            }
        }
        
        // DO capture buttons
        for (let i = 1; i <= 2; i++) {
            const btn = document.getElementById(`doCapture${i}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (calState.do.voltage === null) {
                        alert('No voltage reading available. Is the sensor connected?');
                        return;
                    }
                    
                    calState.do.points = calState.do.points.filter(p => p.pointNum !== i);
                    
                    const tempC = parseFloat(document.getElementById('doBufferTemp')?.value) || 25;
                    const doValue = i === 1 ? getDOSaturation(tempC) : 0;
                    
                    calState.do.points.push({
                        pointNum: i,
                        value: doValue,
                        voltage: calState.do.voltage
                    });
                    
                    updatePointUI('do', i);
                });
            }
        }
        
        // TDS capture buttons
        for (let i = 1; i <= 2; i++) {
            const btn = document.getElementById(`tdsCapture${i}`);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (calState.tds.voltage === null) {
                        alert('No voltage reading available. Is the sensor connected?');
                        return;
                    }
                    
                    const standardInput = document.getElementById(`tdsStandard${i}`);
                    const standardValue = parseFloat(standardInput?.value);
                    
                    if (!standardValue || standardValue <= 0) {
                        alert('Please enter a valid TDS standard value (ppm)');
                        return;
                    }
                    
                    calState.tds.points = calState.tds.points.filter(p => p.pointNum !== i);
                    calState.tds.points.push({
                        pointNum: i,
                        value: standardValue,
                        voltage: calState.tds.voltage
                    });
                    
                    updatePointUI('tds', i);
                });
            }
        }
        
        // Apply buttons
        for (const sensor of ['ph', 'do', 'tds']) {
            const applyBtn = document.getElementById(`${sensor}ApplyBtn`);
            if (applyBtn) {
                applyBtn.addEventListener('click', () => saveCalibration(sensor));
            }
            
            const clearBtn = document.getElementById(`${sensor}ClearBtn`);
            if (clearBtn) {
                clearBtn.addEventListener('click', () => clearCalibration(sensor));
            }
        }
    }
    
    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        setupEventListeners();
        loadCalibration();
        fetchVoltage();
        setInterval(fetchVoltage, 2000);
    });
})();

// === PREDICTION TAB NOTE ===
// The Prediction tab is for viewing ML predictions based on training data.
// Inputs in prediction tab are for generating predictions, NOT for saving training data.
// Training data is submitted from the Training tab and saved to history.

// === RELAY EVENT LOGGING (Actuator State Change Tracking) ===
document.addEventListener('DOMContentLoaded', () => {
    // Hook relay toggle buttons to log events
    const relayButtons = document.querySelectorAll('[id^="relay"][id$="-toggle"], [data-relay-id]');
    
    relayButtons.forEach(btn => {
        // Extract relay ID from button ID or data attribute
        let relayId = null;
        const idMatch = btn.id?.match(/relay(\d+)/);
        if (idMatch) {
            relayId = parseInt(idMatch[1]);
        } else {
            relayId = parseInt(btn.getAttribute('data-relay-id'));
        }
        
        if (!relayId) return;
        
        // Wrap existing click handler or add new one
        const originalHandler = btn.onclick;
        btn.onclick = async function(e) {
            // Call original handler first
            if (originalHandler) {
                originalHandler.call(this, e);
            }
            
            // Determine new state from button class or aria-pressed
            let newState = null;
            if (btn.classList.contains('on')) newState = 1;
            else if (btn.classList.contains('off')) newState = 0;
            else if (btn.getAttribute('aria-pressed') === 'true') newState = 1;
            else if (btn.getAttribute('aria-pressed') === 'false') newState = 0;
            
            if (newState === null) {
                console.log(`Could not determine relay ${relayId} state after toggle`);
                return;
            }
            
            // Log the event to API
            try {
                await waitForAPIUrl();
                const res = await fetch(`${RELAY_API_URL}/relay-event`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        relay_id: relayId,
                        state: newState,
                        meta: { source: 'dashboard' }
                    })
                });
                
                if (!res.ok) {
                    console.error(`Failed to log relay ${relayId} event:`, res.statusText);
                }
            } catch (error) {
                console.error(`Error logging relay ${relayId} event:`, error);
            }
        };
    });
});

// ==================== Serial Console (Manual Tab) ====================
(function() {
	const output = document.getElementById('serialOutput');
	const cmdInput = document.getElementById('serialCmdInput');
	const sendBtn = document.getElementById('serialSendBtn');
	const pauseBtn = document.getElementById('serialPauseBtn');
	const clearBtn = document.getElementById('serialClearBtn');
	const autoScrollChk = document.getElementById('serialAutoScroll');
	const statusEl = document.getElementById('serialStatus');
	
	if (!output) return; // Manual tab not in DOM

	let paused = false;
	let lastLineCount = 0;
	let pollInterval = null;

	function classifyLine(line) {
		if (line.includes('>>>')) return 'cmd-line';
		if (line.includes('[E]') || line.includes('ERROR') || line.includes('error') || line.includes('failed') || line.includes('Poll failed')) return 'error-line';
		if (line.includes('{') && line.includes('}')) return 'json-line';
		if (line.includes('WiFi') || line.includes('IP:')) return 'wifi-line';
		return '';
	}

	function renderLines(lines) {
		const fragment = document.createDocumentFragment();
		lines.forEach(line => {
			const div = document.createElement('div');
			div.className = 'serial-line ' + classifyLine(line);
			div.textContent = line;
			fragment.appendChild(div);
		});
		return fragment;
	}

	async function fetchSerialLog() {
		if (paused) return;
		try {
			const res = await fetch(`${RELAY_API_URL}/serial-log?limit=200`);
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const data = await res.json();
			
			statusEl.textContent = '● Connected';
			statusEl.className = 'serial-status connected';

			if (data.count !== lastLineCount) {
				lastLineCount = data.count;
				output.innerHTML = '';
				output.appendChild(renderLines(data.lines));
				if (autoScrollChk.checked) {
					output.scrollTop = output.scrollHeight;
				}
			}
		} catch (e) {
			statusEl.textContent = '● Disconnected';
			statusEl.className = 'serial-status disconnected';
		}
	}

	async function sendCommand(cmd) {
		if (!cmd) return;
		try {
			const res = await fetch(`${RELAY_API_URL}/serial-cmd`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cmd })
			});
			const data = await res.json();
			if (!data.success) {
				console.warn('Serial command error:', data.error);
			}
			// Fetch updated log immediately
			setTimeout(fetchSerialLog, 300);
		} catch (e) {
			console.error('Serial command failed:', e);
		}
	}

	sendBtn.addEventListener('click', () => {
		const cmd = cmdInput.value.trim();
		if (cmd) {
			sendCommand(cmd);
			cmdInput.value = '';
		}
	});

	cmdInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			sendBtn.click();
		}
	});

	pauseBtn.addEventListener('click', () => {
		paused = !paused;
		pauseBtn.textContent = paused ? '▶️' : '⏸️';
		pauseBtn.title = paused ? 'Resume' : 'Pause';
	});

	clearBtn.addEventListener('click', () => {
		output.innerHTML = '';
		lastLineCount = 0;
	});

	document.querySelectorAll('.serial-quick-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const cmd = btn.getAttribute('data-cmd');
			sendCommand(cmd);
		});
	});

	// Only poll when the manual tab is visible
	function startPolling() {
		if (!pollInterval) {
			fetchSerialLog();
			pollInterval = setInterval(fetchSerialLog, 1500);
		}
	}

	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	}

	// Watch for tab switches
	const observer = new MutationObserver(() => {
		const manualSection = document.getElementById('manual');
		if (manualSection && manualSection.classList.contains('active')) {
			startPolling();
		} else {
			stopPolling();
		}
	});

	const manualSection = document.getElementById('manual');
	if (manualSection) {
		observer.observe(manualSection, { attributes: true, attributeFilter: ['class'] });
		// Also start if already active
		if (manualSection.classList.contains('active')) startPolling();
	}
})();
