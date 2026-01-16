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

		toggle.addEventListener('change', () => {
			const isChecked = toggle.checked;
			if (toggleText) toggleText.textContent = isChecked ? 'ON' : 'OFF';
			config.sections.forEach(id => {
				const el = document.getElementById(id);
				if (el) {
					if (id.includes('ModeSection')) el.style.display = isChecked ? 'flex' : 'none';
					else el.style.display = isChecked ? 'block' : 'none';
				}
			});
			
			// When turning ON, reset inputs to clear previous data
			if (isChecked) {
				resetInputs(sensorType);
			} 
			// When turning OFF, clear all input data and reset state
			else {
				state[sensorType].data = [];
				state[sensorType].currentPoint = 1;
			}
		});
	}

	function resetInputs(sensorType) {
		const config = sensorConfigs[sensorType];
		const container = document.getElementById(config.containerId);
		if (!container) return;

		state[sensorType].currentPoint = 1;
		state[sensorType].data = [];

		const sensorState = state[sensorType];
		const isOnePoint = sensorState.mode === '1';
		const applyBtnHtml = !isOnePoint ? `<button class="btn btn-apply" id="${config.applyBtnId}">Apply</button>` : '';
		
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

		// Update display values for pH
		if (sensorType === 'ph' && config.displayIds) {
			Object.entries(config.displayIds).forEach(([key, id]) => {
				const el = document.getElementById(id);
				if (el) el.textContent = lastPoint[key].toFixed(2);
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
		calDate.textContent = `${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${now.toLocaleDateString()}`;
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
				const btn = e.target;
				const isApply = btn.classList.contains('btn-apply') || btn.id.includes('applyInputs');
				const isEdit = btn.classList.contains('btn-edit') || btn.id.includes('editInputs');

				if (!isApply && !isEdit) return;

				const grid = btn.closest('.inputs-grid');
				const pointNum = parseInt(grid.getAttribute('data-point'));
				const inputs = grid.querySelectorAll('input');

				if (isApply) {
					let allFilled = true;
					inputs.forEach(i => { if (!i.value.trim()) allFilled = false; });
					
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

					inputs.forEach(i => i.disabled = true);
					btn.textContent = 'Edit';
					btn.classList.remove('btn-apply');
					btn.classList.add('btn-edit');

					// Show calibration values section only if all required points are completed
					const requiredPoints = parseInt(state[sensorType].mode);
					const completedPoints = state[sensorType].data.length;
					
					if (completedPoints >= requiredPoints) {
						const valSection = document.getElementById(config.sections[2]);
						if (valSection) valSection.style.setProperty('display', 'block', 'important');
					}
					const inputPanel = document.getElementById(config.sections[1]);
					if (inputPanel) inputPanel.style.setProperty('display', 'block', 'important');
				} else {
					inputs.forEach(i => i.disabled = false);
					btn.textContent = 'Apply';
					btn.classList.remove('btn-edit');
					btn.classList.add('btn-apply');
					
					// Hide calibration values section when editing
					const valSection = document.getElementById(config.sections[2]);
					if (valSection) valSection.style.display = 'none';
					
					// Remove the data point from state
					const existingIdx = state[sensorType].data.findIndex(d => d.point === pointNum);
					if (existingIdx >= 0) state[sensorType].data.splice(existingIdx, 1);
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
			if(t === 'predicting') {
				if(predictionItem) {
					const isOpen = predictionItem.classList.toggle('open');
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
			
			// Close prediction dropdown when switching to other tabs
			if(t !== 'predicting' && predictionItem) {
				predictionItem.classList.remove('open');
			}
			
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
		const historyState = { method: 'aero', plant: '1', interval: 'Daily' };
		const historyEmptyCell = historyBoard.querySelector('.history-empty');

		const updateHistoryEmpty = () => {
			if (!historyEmptyCell) return;
			const methodLabel = historyBoard.querySelector('.history-tab-btn.active')?.textContent?.trim() || 'Aeroponics';
			const intervalLabel = historyBoard.querySelector('.history-chip.active')?.textContent?.trim() || 'Daily';
			const plantLabel = historyBoard.querySelector('.history-pill.active')?.textContent?.trim() || '1';
			historyEmptyCell.textContent = `No data yet for Plant ${plantLabel} (${intervalLabel}, ${methodLabel}).`;
		};

		historyBoard.querySelectorAll('.history-tab-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				historyBoard.querySelectorAll('.history-tab-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				historyState.method = btn.getAttribute('data-history-tab') || historyState.method;
				updateHistoryEmpty();
			});
		});

		historyBoard.querySelectorAll('.history-pill').forEach(pill => {
			pill.addEventListener('click', () => {
				historyBoard.querySelectorAll('.history-pill').forEach(p => p.classList.remove('active'));
				pill.classList.add('active');
				historyState.plant = pill.textContent.trim();
				updateHistoryEmpty();
			});
		});

		historyBoard.querySelectorAll('.history-chip').forEach(chip => {
			chip.addEventListener('click', () => {
				historyBoard.querySelectorAll('.history-chip').forEach(c => c.classList.remove('active'));
				chip.classList.add('active');
				historyState.interval = chip.textContent.trim();
				updateHistoryEmpty();
			});
		});

		updateHistoryEmpty();
	}

	// Prediction dropdown option click handlers
	document.querySelectorAll('.prediction-option').forEach(option => {
		option.addEventListener('click', (e) => {
			e.preventDefault();
			const metric = option.getAttribute('data-metric');
			// Update active state (just mark it, don't generate yet)
			document.querySelectorAll('.prediction-option').forEach(opt => opt.classList.remove('active'));
			option.classList.add('active');
			// Don't auto-generate - wait for user to click method button
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

	// Helper function to update sensor alert
	function updateSensorAlert(sensorType, value){
		const alertEl = document.getElementById(`alert-${sensorType}`);
		if(!alertEl) return;

		const {status, statusClass} = getSensorStatus(sensorType, value);
		alertEl.textContent = status;
		alertEl.className = `alert ${statusClass}`;

		// Only show notifications for warning (normal) and critical (dangerous), not optimal (neutral)
		if(statusClass !== 'neutral'){
			showNotification(sensorType, value, status, statusClass);
		}
	}

	// Railway API endpoint for real sensor data
	const SENSOR_API_URL = 'https://sensorcollector-production.up.railway.app/api/latest';

	async function updateSensorsAndActuators(){
		try {
			// Fetch real sensor data from Railway API
			const response = await fetch(SENSOR_API_URL);
			if (!response.ok) throw new Error('API request failed');
			const data = await response.json();
			
			// Extract values from API response (with fallbacks)
			const phValue = data.ph ? data.ph.value.toFixed(2) : '--';
			const doValue = data.do_mg_l ? data.do_mg_l.value.toFixed(1) : '--';
			const tempValue = data.temperature_c ? data.temperature_c.value.toFixed(1) : '--';
			const humValue = data.humidity ? Math.floor(data.humidity.value) : '--';
			const tdsValue = data.tds_ppm ? data.tds_ppm.value.toFixed(2) : '--';
			
			// Update DOM with real values
			document.getElementById('val-ph').textContent = phValue;
			document.getElementById('val-do').textContent = doValue;
			document.getElementById('val-temp').textContent = tempValue;
			document.getElementById('val-hum').textContent = humValue;
			document.getElementById('val-tds').textContent = tdsValue;

			// Record values for sensor graphs time series (only if valid)
			if (phValue !== '--') recordSensorValue('ph', parseFloat(phValue));
			if (doValue !== '--') recordSensorValue('do', parseFloat(doValue));
			if (tempValue !== '--') recordSensorValue('temp', parseFloat(tempValue));
			if (humValue !== '--') recordSensorValue('hum', parseFloat(humValue));
			if (tdsValue !== '--') recordSensorValue('tds', parseFloat(tdsValue));
			
			// Update alerts based on values
			if (phValue !== '--') updateSensorAlert('ph', phValue);
			if (doValue !== '--') updateSensorAlert('do', doValue);
			if (tempValue !== '--') updateSensorAlert('temp', tempValue);
			if (humValue !== '--') updateSensorAlert('hum', humValue);
			if (tdsValue !== '--') updateSensorAlert('tds', tdsValue);

		} catch (error) {
			console.error('Failed to fetch sensor data:', error);
			// Show error state in UI
			['val-ph', 'val-do', 'val-temp', 'val-hum', 'val-tds'].forEach(id => {
				const el = document.getElementById(id);
				if (el && el.textContent === '') el.textContent = '--';
			});
		}

		// Actuators remain manual for now (can be connected to separate actuator API later)
		// Keep current state instead of randomizing
	}

	// helper: set actuator state text + class
	function setActuatorState(id, state){
		const el = document.getElementById(id);
		if(!el) return;
		el.textContent = state;
		el.classList.remove('on','off');
		if(state === 'ON') el.classList.add('on'); else el.classList.add('off');
	}

	// make actuator rows clickable to toggle
	document.querySelectorAll('.actuators .act').forEach(actEl=>{
		actEl.addEventListener('click', ()=>{
			const span = actEl.querySelector('.state');
			if(!span || !span.id) return;
			const current = span.textContent.trim();
			const next = current === 'ON' ? 'OFF' : 'ON';
			setActuatorState(span.id, next);
		});
	});

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
			{ id: 'btn-ph-up', label: 'pH Up' },
			{ id: 'btn-ph-down', label: 'pH Down' },
			{ id: 'btn-leafy-green', label: 'Leafy Green' }
		];

		actions.forEach(action => {
			const btn = document.getElementById(action.id);
			if(!btn) return;
			btn.addEventListener('click', () => {
				if(btn.disabled) return;
				btn.disabled = true;
				btn.classList.add('is-dosing');
				btn.setAttribute('aria-pressed', 'true');
				showNutrientNotification(action.label);
				setTimeout(() => {
					btn.disabled = false;
					btn.classList.remove('is-dosing');
					btn.setAttribute('aria-pressed', 'false');
				}, 5000);
			});
		});
	}

	setupNutrientButtons();

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
	
	// Real-time updates every 1 second
	setInterval(()=>{ drawMini('mini1'); drawMini('mini2'); drawMini('mini3'); updateSensorsAndActuators(); }, 1000);
	
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
			currentDays = parseInt(btn.getAttribute('data-days'));
			drawComparisonGraph();
		});
	});

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
		const body = document.getElementById('successModalBody');
		
		if (modal && body) {
			// Format the submitted data for display
			let htmlContent = '<div style="font-size: 14px; line-height: 1.8;">';
			
			// Sensor Readings
			const sensorCard = document.querySelector('[data-sensor="all"]');
			if (sensorCard) {
				htmlContent += '<strong>Sensor Readings:</strong><br>';
				const fields = ['ph', 'do', 'tds', 'temp', 'hum'];
				fields.forEach(field => {
					const input = sensorCard.querySelector(`[data-field="${field}"]`);
					if (input && input.value) {
						const label = input.closest('.sensor-input-label').querySelector('.sensor-label-text').textContent;
						const unit = input.closest('.sensor-input-label').querySelector('.sensor-unit').textContent;
						htmlContent += `${label}: ${input.value} ${unit}<br>`;
					}
				});
				htmlContent += '<br>';
			}

			// Traditional Farming
			const traditionalList = document.getElementById('traditionalPlantsList');
			if (traditionalList) {
				const rows = traditionalList.querySelectorAll('.sensor-inputs-row1');
				if (rows.length > 0) {
					htmlContent += '<strong>Traditional Farming:</strong><br>';
					rows.forEach((row, idx) => {
						const height = row.querySelector('[data-field="height"]')?.value || '-';
						const length = row.querySelector('[data-field="length"]')?.value || '-';
						const width = row.querySelector('[data-field="width"]')?.value || '-';
						const leaves = row.querySelector('[data-field="leaves"]')?.value || '-';
						const branches = row.querySelector('[data-field="branches"]')?.value || '-';
						htmlContent += `Plant ${idx + 1}: H=${height}, L=${length}, W=${width}, Leaves=${leaves}, Branches=${branches}<br>`;
					});
					htmlContent += '<br>';
				}
			}

			// DWC
			const dwcList = document.getElementById('dwcPlantsList');
			if (dwcList) {
				const rows = dwcList.querySelectorAll('.sensor-inputs-row1');
				if (rows.length > 0) {
					htmlContent += '<strong>Deep Water Culture:</strong><br>';
					rows.forEach((row, idx) => {
						const height = row.querySelector('[data-field="height"]')?.value || '-';
						const length = row.querySelector('[data-field="length"]')?.value || '-';
						const width = row.querySelector('[data-field="width"]')?.value || '-';
						const leaves = row.querySelector('[data-field="leaves"]')?.value || '-';
						const branches = row.querySelector('[data-field="branches"]')?.value || '-';
						htmlContent += `Plant ${idx + 1}: H=${height}, L=${length}, W=${width}, Leaves=${leaves}, Branches=${branches}<br>`;
					});
					htmlContent += '<br>';
				}
			}

			// Aeroponics
			const aeroList = document.getElementById('aeroponicsPlantsList');
			if (aeroList) {
				const rows = aeroList.querySelectorAll('.sensor-inputs-row1');
				if (rows.length > 0) {
					htmlContent += '<strong>Aeroponics:</strong><br>';
					rows.forEach((row, idx) => {
						const height = row.querySelector('[data-field="height"]')?.value || '-';
						const length = row.querySelector('[data-field="length"]')?.value || '-';
						const width = row.querySelector('[data-field="width"]')?.value || '-';
						const leaves = row.querySelector('[data-field="leaves"]')?.value || '-';
						const branches = row.querySelector('[data-field="branches"]')?.value || '-';
						htmlContent += `Plant ${idx + 1}: H=${height}, L=${length}, W=${width}, Leaves=${leaves}, Branches=${branches}<br>`;
					});
				}
			}

			htmlContent += '</div>';
			body.innerHTML = htmlContent;
			modal.style.display = 'flex';
		}
	}

	function closeSuccessModal() {
		const modal = document.getElementById('successModal');
		if (modal) {
			modal.style.display = 'none';
		}
	}

	function submitAeroponicsPlantList() {
		const list = document.getElementById('aeroponicsPlantsList');
		if (!list) return;
		const card = list.querySelector('.sensor-input-card1');
		if (!card) return;

		const rows = Array.from(card.querySelectorAll('.sensor-inputs-row1'));
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

		// Validate all fields are filled
		const hasEmptyFields = data.some(plant => 
			!plant.height || !plant.length || !plant.width || !plant.leaves || !plant.branches
		);

		if (hasEmptyFields) {
			showValidationError();
			return;
		}

		// Show success modal
		showSuccessModal(data);
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

	// Success modal event listeners
	const successCloseBtn = document.getElementById('successModalClose');
	if (successCloseBtn) {
		successCloseBtn.addEventListener('click', () => {
			closeSuccessModal();
			clearAllFields();
		});
	}

	const successOkBtn = document.getElementById('successOkBtn');
	if (successOkBtn) {
		successOkBtn.addEventListener('click', () => {
			closeSuccessModal();
			clearAllFields();
		});
	}

	const successModal = document.getElementById('successModal');
	if (successModal) {
		successModal.addEventListener('click', (e) => {
			if (e.target === successModal) {
				closeSuccessModal();
				clearAllFields();
			}
		});
	}

	// Calibration apply
	const applyCal = document.getElementById('applyCal');
	applyCal.addEventListener('click', ()=>{
		const sensor = document.getElementById('calSensor').value;
		const offset = parseFloat(document.getElementById('calOffset').value) || 0;
		alert(`Applied calibration offset ${offset} to ${sensor}`);
	});




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
		label: 'width', 
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
		
		const canvas = document.createElement('canvas');
		canvas.className = 'plant-graph-canvas';
		canvas.id = `plant-${plant.plantNum}-${farmingMethod}-graph`;
		canvas.width = 600;
		canvas.height = 250;
		
		card.appendChild(header);
		card.appendChild(canvas);
		container.appendChild(card);
		
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
	
	// Generate prediction data (each plant has slightly different data)
	const baseValue = (minVal + maxVal) / 2;
	const variance = (maxVal - minVal) / 8;
	const plantVariance = (plantNum - 3.5) * (variance * 0.3); // Each plant differs slightly
	const data = window.randomWalk(30, baseValue + plantVariance, variance)
		.map(v => Math.max(minVal, Math.min(maxVal, v)));
	
	// Draw smooth line with gradient fill
	const plotW = w - leftPad - rightPad;
	const plotH = h - topPad - bottomPad;
	
	// Create gradient fill
	const gradient = ctx.createLinearGradient(leftPad, topPad, leftPad, h - bottomPad);
	gradient.addColorStop(0, 'rgba(43, 110, 246, 0.2)');
	gradient.addColorStop(1, 'rgba(43, 110, 246, 0)');
	
	// Draw fill area
	ctx.beginPath();
	const points = [];
	data.forEach((val, i) => {
		const x = leftPad + (i / (data.length - 1)) * plotW;
		const y = topPad + (1 - (val - minVal) / (maxVal - minVal)) * plotH;
		points.push({x, y});
		if(i === 0) ctx.moveTo(x, y);
		else {
			// Smooth curve
			const prevPoint = points[i - 1];
			const cpX = (prevPoint.x + x) / 2;
			const cpY = (prevPoint.y + y) / 2;
			ctx.quadraticCurveTo(prevPoint.x, prevPoint.y, cpX, cpY);
		}
	});
	
	// Close fill area
	ctx.lineTo(points[points.length - 1].x, h - bottomPad);
	ctx.lineTo(points[0].x, h - bottomPad);
	ctx.closePath();
	ctx.fillStyle = gradient;
	ctx.fill();
	
	// Draw line
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
	ctx.quadraticCurveTo(points[points.length - 1].x, points[points.length - 1].y, points[points.length - 1].x, points[points.length - 1].y);
	
	ctx.strokeStyle = '#2b6ef6';
	ctx.lineWidth = 3;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.shadowColor = 'rgba(43, 110, 246, 0.3)';
	ctx.shadowBlur = 6;
	ctx.stroke();
	ctx.shadowBlur = 0;
	
	// Draw data points at key positions
	points.forEach((point, i) => {
		if(i % 5 === 0 || i === points.length - 1) {
			ctx.beginPath();
			ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
			ctx.fillStyle = '#ffffff';
			ctx.fill();
			ctx.strokeStyle = '#2b6ef6';
			ctx.lineWidth = 2;
			ctx.stroke();
		}
	});
	
	// X-axis labels
	ctx.fillStyle = '#9aa4b8';
	ctx.font = '10px Segoe UI, Arial, sans-serif';
	ctx.textAlign = 'center';
	const days = ['Day 1', 'Day 10', 'Day 20', 'Day 30'];
	days.forEach((day, i) => {
		const x = leftPad + (i / (days.length - 1)) * plotW;
		ctx.fillText(day, x, h - bottomPad + 20);
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

// Comparison Graph Functionality
let currentDays = 1;
let graphData = {
	aeroponic: [],
	dwc: [],
	traditional: []
};

function generateGraphData(days) {
	const points = Math.min(days * 4, 120); // Max 120 points for smoothness
	
	// Aeroponic - fastest growth, highest values
	const aeroponicBase = 50;
	const aeroponicData = window.randomWalk(points, aeroponicBase, 8)
		.map((v, i) => Math.max(30, Math.min(100, v + (i / points) * 15)));
	
	// Deep Water Culture - medium growth
	const dwcBase = 45;
	const dwcData = window.randomWalk(points, dwcBase, 7)
		.map((v, i) => Math.max(25, Math.min(90, v + (i / points) * 12)));
	
	// Traditional - slowest growth
	const traditionalBase = 40;
	const traditionalData = window.randomWalk(points, traditionalBase, 6)
		.map((v, i) => Math.max(20, Math.min(80, v + (i / points) * 10)));
	
	return {
		aeroponic: aeroponicData,
		dwc: dwcData,
		traditional: traditionalData,
		points: points
	};
}

function drawComparisonGraph() {
	const canvas = document.getElementById('comparisonGraph');
	if(!canvas || !canvas.getContext) return;
	
	const container = canvas.parentElement;
	if(!container) return;
	
	const containerRect = container.getBoundingClientRect();
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
	
	// Generate data based on current days
	const data = generateGraphData(currentDays);
	graphData = data;
	
	// Find min and max for scaling
	const allValues = [...data.aeroponic, ...data.dwc, ...data.traditional];
	const min = Math.min(...allValues);
	const max = Math.max(...allValues);
	const range = max - min || 1;
	
	// Draw grid lines
	ctx.strokeStyle = '#e8ecf4';
	ctx.lineWidth = 1;
	ctx.setLineDash([4, 4]);
	
	// Horizontal grid lines
	for(let i = 0; i <= 5; i++) {
		const y = topPad + (i / 5) * plotH;
		ctx.beginPath();
		ctx.moveTo(leftPad, y);
		ctx.lineTo(w - rightPad, y);
		ctx.stroke();
		
		// Y-axis labels
		if(i === 0 || i === 5 || i === 2.5) {
			const val = max - (i / 5) * range;
			ctx.fillStyle = '#6c7380';
			ctx.font = '11px Poppins, sans-serif';
			ctx.textAlign = 'right';
			ctx.setLineDash([]);
			ctx.fillText(Math.round(val).toString(), leftPad - 10, y + 4);
			ctx.setLineDash([4, 4]);
		}
	}
	
	// Vertical grid lines
	ctx.strokeStyle = '#f0f4f8';
	for(let i = 0; i <= 5; i++) {
		const x = leftPad + (i / 5) * plotW;
		ctx.beginPath();
		ctx.moveTo(x, topPad);
		ctx.lineTo(x, h - bottomPad);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	
	// Draw lines for each method
	const methods = [
		{ data: data.aeroponic, color: '#4CAF50', name: 'Aeroponic' },
		{ data: data.dwc, color: '#2196F3', name: 'Deep Water Culture' },
		{ data: data.traditional, color: '#FF9800', name: 'Traditional' }
	];
	
	methods.forEach(method => {
		const points = [];
		method.data.forEach((val, i) => {
			const x = leftPad + (i / (method.data.length - 1)) * plotW;
			const y = topPad + (1 - (val - min) / range) * plotH;
			points.push({ x, y, val });
		});
		
		// Draw gradient fill
		const gradient = ctx.createLinearGradient(leftPad, topPad, leftPad, h - bottomPad);
		const color = method.color;
		gradient.addColorStop(0, color + '30');
		gradient.addColorStop(1, color + '00');
		
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
		
		// Draw line
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
		ctx.lineWidth = 3;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.shadowColor = method.color + '40';
		ctx.shadowBlur = 8;
		ctx.stroke();
		ctx.shadowBlur = 0;
		
		// Store points for hover detection
		method.points = points;
	});
	
	// Draw data points at key positions
	methods.forEach(method => {
		method.points.forEach((point, i) => {
			if(i % Math.ceil(method.points.length / 8) === 0 || i === method.points.length - 1) {
				ctx.beginPath();
				ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
				ctx.fillStyle = '#ffffff';
				ctx.fill();
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
	
	// Y-axis label
	ctx.save();
	ctx.translate(20, h / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillStyle = '#6c7380';
	ctx.font = '12px Poppins, sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText('Growth Rate (%)', 0, 0);
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

// ==================== RELAY CONTROL ====================
const RELAY_API_URL = 'https://sensorcollector-production.up.railway.app/api';

// Track if we're currently toggling to prevent polling conflicts
let isToggling = false;

// Fetch and sync relay states from server
async function fetchRelayStates() {
    // Don't fetch while toggling to prevent state conflicts
    if (isToggling) return;
    
    try {
        const response = await fetch(`${RELAY_API_URL}/relay/status`);
        if (!response.ok) throw new Error('Failed to fetch relay status');
        const data = await response.json();
        
        data.relays.forEach(relay => {
            const checkbox = document.getElementById(`relay-${relay.id}`);
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = relay.state;
            }
        });
    } catch (error) {
        console.error('Failed to fetch relay states:', error);
    }
}

// Toggle a relay on/off
async function toggleRelay(relayId, turnOn) {
    const checkbox = document.getElementById(`relay-${relayId}`);
    if (checkbox) checkbox.disabled = true;
    isToggling = true;
    
    try {
        const action = turnOn ? 'on' : 'off';
        const response = await fetch(`${RELAY_API_URL}/relay/${relayId}/${action}`, {
            method: 'POST'
        });
        
        if (!response.ok) throw new Error('Failed to toggle relay');
        const data = await response.json();
        console.log(`Relay ${relayId} -> ${action}`, data);
        
        // Update checkbox to match server response
        if (checkbox) checkbox.checked = data.state;
        
    } catch (error) {
        console.error(`Failed to toggle relay ${relayId}:`, error);
        // Revert checkbox on error
        if (checkbox) checkbox.checked = !turnOn;
    } finally {
        if (checkbox) checkbox.disabled = false;
        // Small delay before allowing polling again
        setTimeout(() => { isToggling = false; }, 500);
    }
}

// Initialize relay controls
function initRelayControls() {
    // Set all checkboxes to OFF initially (visual default)
    for (let i = 1; i <= 8; i++) {
        const checkbox = document.getElementById(`relay-${i}`);
        if (checkbox) {
            checkbox.checked = false; // Default to OFF
            checkbox.addEventListener('change', (e) => {
                toggleRelay(i, e.target.checked);
            });
        }
    }
    
    // Fetch actual relay states from server
    fetchRelayStates();
    
    // Poll relay states every 2 seconds to stay in sync
    setInterval(fetchRelayStates, 2000);
}

// Initialize relay controls when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRelayControls);
} else {
    initRelayControls();
}
