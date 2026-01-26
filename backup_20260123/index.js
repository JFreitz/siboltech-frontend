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

	

	// Create overlay for mobile sidebar
	let overlay = document.querySelector('.sidebar-overlay');
	if (!overlay) {
		overlay = document.createElement('div');
		overlay.className = 'sidebar-overlay';
		document.body.appendChild(overlay);
	}
	
	// Close sidebar when clicking overlay
	overlay.addEventListener('click', () => {
		sidebar.classList.remove('mobile-open');
		overlay.classList.remove('active');
	});

	// Toggle sidebar (collapse/expand on desktop, open/close on mobile)
	burger.addEventListener('click', ()=>{
		// For mobile (small screens), use 'mobile-open' class for slide in/out
		if(window.innerWidth <= 768){
			const isOpen = sidebar.classList.toggle('mobile-open');
			overlay.classList.toggle('active', isOpen);
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
			if(window.innerWidth <= 768) { sidebar.classList.remove('mobile-open'); document.querySelector('.sidebar-overlay')?.classList.remove('active'); }
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
		const historyTableBody = historyBoard.querySelector('.history-table-wrap[data-history-view="sensor"] tbody');

		// Fetch and display sensor history data
		async function fetchSensorHistory() {
			const interval = historyState.interval === 'Daily' ? 'daily' : '15min';
			const days = interval === 'daily' ? 30 : 1; // 30 days for daily, 1 day for 15min
			
			try {
				const response = await fetch(`${RELAY_API_URL}/history?interval=${interval}&days=${days}&limit=50`);
				if (!response.ok) throw new Error('Failed to fetch history');
				
				const data = await response.json();
				
				if (data.success && data.readings && data.readings.length > 0) {
					renderHistoryTable(data.readings);
				} else {
					showHistoryEmpty();
				}
			} catch (err) {
				console.error('History fetch error:', err);
				showHistoryEmpty();
			}
		}
		
		// Render history data to the table
		function renderHistoryTable(readings) {
			if (!historyTableBody) return;
			
			const rows = readings.map(r => `
				<tr>
					<td>${r.timestamp || '-'}</td>
					<td>${r.ph !== null ? r.ph : '-'}</td>
					<td>${r.do !== null ? r.do + ' mg/L' : '-'}</td>
					<td>${r.tds !== null ? r.tds + ' ppm' : '-'}</td>
					<td>${r.temp !== null ? r.temp + ' °C' : '-'}</td>
					<td>${r.humidity !== null ? r.humidity + ' %' : '-'}</td>
					<td colspan="5" class="plant-data-na">-</td>
				</tr>
			`).join('');
			
			historyTableBody.innerHTML = rows;
		}
		
		// Show empty state message
		function showHistoryEmpty() {
			if (!historyTableBody) return;
			const methodLabel = historyBoard.querySelector('[data-history-tab].active')?.textContent?.trim() || 'Aeroponics';
			const intervalLabel = historyState.interval;
			historyTableBody.innerHTML = `
				<tr>
					<td colspan="11" class="history-empty">No sensor data available for ${intervalLabel} interval (${methodLabel}).</td>
				</tr>
			`;
		}

		const updateHistoryEmpty = () => {
			// Now fetches real data instead of just showing empty
			fetchSensorHistory();
		};

		historyBoard.querySelectorAll('[data-history-tab]').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				historyBoard.querySelectorAll('[data-history-tab]').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				historyState.method = btn.getAttribute('data-history-tab') || historyState.method;
				
				// Toggle history table views based on selected method
				const view = historyState.method === 'trad' ? 'plant' : 'sensor';
				historyBoard.querySelectorAll('.history-table-wrap').forEach(w => {
					if (w.getAttribute('data-history-view') === view) w.style.display = '';
					else w.style.display = 'none';
				});
				
				// Fetch data for sensor view
				if (view === 'sensor') {
					fetchSensorHistory();
				}
			});
		});

		// Initialize view visibility
		historyBoard.querySelectorAll('.history-table-wrap').forEach(w => {
			const view = historyState.method === 'trad' ? 'plant' : 'sensor';
			if (w.getAttribute('data-history-view') === view) w.style.display = '';
			else w.style.display = 'none';
		});

		historyBoard.querySelectorAll('.history-pill').forEach(pill => {
			pill.addEventListener('click', () => {
				historyBoard.querySelectorAll('.history-pill').forEach(p => p.classList.remove('active'));
				pill.classList.add('active');
				historyState.plant = pill.textContent.trim();
				// Plant selection doesn't affect sensor data, but refresh anyway
				fetchSensorHistory();
			});
		});

		historyBoard.querySelectorAll('.history-chip').forEach(chip => {
			chip.addEventListener('click', () => {
				historyBoard.querySelectorAll('.history-chip').forEach(c => c.classList.remove('active'));
				chip.classList.add('active');
				historyState.interval = chip.textContent.trim();
				// Fetch new data when interval changes
				fetchSensorHistory();
			});
		});

		// Initial load
		fetchSensorHistory();
	}

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
			if(window.innerWidth <= 768) { sidebar.classList.remove('mobile-open'); document.querySelector('.sidebar-overlay')?.classList.remove('active'); }
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

		// Only show notifications for warning (normal) and critical (dangerous), not optimal (neutral)
		if(statusClass !== 'neutral'){
			showNotification(sensorType, value, status, statusClass);
		}
	}

	let actuatorOverride = false;

	// Fetch real sensor data from API
	async function fetchSensorData() {
		try {
			const response = await fetch(`${RELAY_API_URL}/latest`);
			if (!response.ok) throw new Error('Failed to fetch sensor data');
			return await response.json();
		} catch (err) {
			console.error('Sensor fetch error:', err);
			return null;
		}
	}

	async function updateSensorsAndActuators(){
		// Fetch real sensor data from API
		const sensorData = await fetchSensorData();
		
		let phValue, doValue, tempValue, humValue, tdsValue;
		
		if (sensorData) {
			// Use real API data
			phValue = sensorData.ph?.value?.toFixed(2) || '0.00';
			doValue = sensorData.do_mg_l?.value?.toFixed(1) || '0.0';
			tempValue = sensorData.temperature_c?.value?.toFixed(1) || '0.0';
			humValue = Math.round(sensorData.humidity?.value || 0);
			tdsValue = Math.round(sensorData.tds_ppm?.value || 0);
		} else {
			// Fallback to last known values or zeros
			phValue = '0.00';
			doValue = '0.0';
			tempValue = '0.0';
			humValue = 0;
			tdsValue = 0;
		}
		
		// push live readings to all mirrored UI blocks (dashboard, training, sensors tab)
		const setValueAll = (key, val) => {
			document.querySelectorAll(`[id="val-${key}"]`).forEach(el => { el.textContent = val; });
		};
		setValueAll('ph', phValue);
		setValueAll('do', doValue);
		setValueAll('temp', tempValue);
		setValueAll('hum', humValue);
		setValueAll('tds', tdsValue);

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

		// Actuators - sync with relay status from API (no random)
		if(!actuatorOverride){
			// Fetch relay status and sync actuator UI
			try {
				const relayResponse = await fetch(`${RELAY_API_URL}/relay/status`);
				if (relayResponse.ok) {
					const relayData = await relayResponse.json();
					if (relayData.relays) {
						relayData.relays.forEach(relay => {
							const actuatorId = RELAY_TO_ACTUATOR[relay.id];
							if (actuatorId) {
								setActuatorStateUI(actuatorId, relay.state ? 'ON' : 'OFF');
							}
						});
					}
				}
			} catch (err) {
				console.error('Relay status fetch error:', err);
			}
			
			// Auto-activate nutrient relays based on sensor thresholds
			checkNutrientAutoActivation(parseFloat(phValue), parseFloat(tdsValue));
		}
	}
	
	// Helper to update actuator UI without sending to API
	function setActuatorStateUI(id, state) {
		const checkbox = document.getElementById(id);
		if(!checkbox) return;
		const label = checkbox.closest('.toggle-switch');
		const toggleText = label ? label.querySelector('.toggle-text') : null;
		const isOn = (state === 'ON');
		
		checkbox.checked = isOn;
		if(toggleText) toggleText.textContent = state;
	}

	// helper: set actuator state text + checkbox AND send to relay API
	function setActuatorState(id, state){
		const checkbox = document.getElementById(id);
		if(!checkbox) return;
		const label = checkbox.closest('.toggle-switch');
		const toggleText = label ? label.querySelector('.toggle-text') : null;
		const isOn = (state === 'ON');
		
		checkbox.checked = isOn;
		if(toggleText) toggleText.textContent = state;
		
		// Also update the physical relay via API (only in auto mode)
		const relayNum = typeof ACTUATOR_TO_RELAY !== 'undefined' ? ACTUATOR_TO_RELAY[id] : null;
		if(relayNum && !actuatorOverride) {
			// Send to relay API for auto-control
			toggleRelay(relayNum, isOn, null);
		}
	}

	// Add event listeners to actuator toggles to update text (moved to setupActuatorRelayControl)
	// Keeping basic text update for manual override mode
	document.querySelectorAll('.actuator-toggle input[type="checkbox"]').forEach(checkbox => {
		checkbox.addEventListener('change', () => {
			const label = checkbox.closest('.toggle-switch');
			const toggleText = label ? label.querySelector('.toggle-text') : null;
			if(toggleText) {
				toggleText.textContent = checkbox.checked ? 'ON' : 'OFF';
			}
			// If override is ON, send to relay API
			if(actuatorOverride) {
				const relayNum = typeof ACTUATOR_TO_RELAY !== 'undefined' ? ACTUATOR_TO_RELAY[checkbox.id] : null;
				if(relayNum) {
					toggleRelay(relayNum, checkbox.checked, null);
				}
			}
		});
	});

	// Override toggle: when ON, freeze auto-updates to actuators; manual toggles control relays directly
	const overrideToggle = document.getElementById('actuatorOverrideToggle');
	if(overrideToggle){
		const updateOverrideState = () => {
			const label = overrideToggle.closest('.toggle-switch');
			const textEl = label ? label.querySelector('.toggle-text') : null;
			actuatorOverride = overrideToggle.checked;
			if(textEl) textEl.textContent = actuatorOverride ? 'ON' : 'OFF';
			
			// Visual feedback: change actuator card styling based on mode
			const actuatorCard = document.querySelector('.actuator-card');
			if(actuatorCard) {
				if(actuatorOverride) {
					actuatorCard.classList.add('manual-mode');
					actuatorCard.classList.remove('auto-mode');
				} else {
					actuatorCard.classList.add('auto-mode');
					actuatorCard.classList.remove('manual-mode');
				}
			}
			
			// Enable/disable actuator toggles visual cue
			document.querySelectorAll('.actuator-toggle').forEach(toggle => {
				if(actuatorOverride) {
					toggle.classList.add('manual-enabled');
				} else {
					toggle.classList.remove('manual-enabled');
				}
			});
			
			console.log(`Override mode: ${actuatorOverride ? 'MANUAL' : 'AUTO'}`);
		};
		overrideToggle.addEventListener('change', updateOverrideState);
		updateOverrideState();
	}

	// Nutrient solution quick actions with 2-second pulse mode
	// Threshold-based logic with HYSTERESIS and MOVING AVERAGE to prevent noise-triggered activations
	// - pH Up: activates when pH < 5.5, deactivates when pH > 5.8
	// - pH Down: activates when pH > 6.5, deactivates when pH < 6.2
	// - Leafy Green: activates when TDS < 600, deactivates when TDS > 650
	const NUTRIENT_THRESHOLDS = {
		'btn-ph-up': { 
			sensor: 'ph', 
			condition: 'below', 
			triggerOn: 5.5,      // Activate when below this
			triggerOff: 5.8,     // Deactivate when above this (hysteresis)
			consecutiveRequired: 3  // Require 3 consecutive readings
		},
		'btn-ph-down': { 
			sensor: 'ph', 
			condition: 'above', 
			triggerOn: 6.5,      // Activate when above this
			triggerOff: 6.2,     // Deactivate when below this (hysteresis)
			consecutiveRequired: 3
		},
		'btn-leafy-green': { 
			sensor: 'tds', 
			condition: 'below', 
			triggerOn: 600,      // Activate when below this
			triggerOff: 650,     // Deactivate when above this (hysteresis)
			consecutiveRequired: 3
		}
	};

	const NUTRIENT_PULSE_DURATION = 2000; // 2 seconds
	const NUTRIENT_AUTO_COOLDOWN = 30000; // 30 seconds cooldown between auto-activations
	const MOVING_AVG_WINDOW = 5; // Number of readings to average

	// State tracking for anti-fluctuation
	const nutrientLastActivation = {
		'btn-ph-up': 0,
		'btn-ph-down': 0,
		'btn-leafy-green': 0
	};
	
	// Moving average buffers
	const sensorHistory = {
		ph: [],
		tds: []
	};
	
	// Consecutive threshold breach counter
	const consecutiveBreaches = {
		'btn-ph-up': 0,
		'btn-ph-down': 0,
		'btn-leafy-green': 0
	};
	
	// Track if nutrient is currently "active" (for hysteresis)
	const nutrientActiveState = {
		'btn-ph-up': false,
		'btn-ph-down': false,
		'btn-leafy-green': false
	};

	// Calculate moving average
	function updateMovingAverage(sensor, newValue) {
		const history = sensorHistory[sensor];
		history.push(newValue);
		if (history.length > MOVING_AVG_WINDOW) {
			history.shift(); // Remove oldest
		}
		return history.reduce((a, b) => a + b, 0) / history.length;
	}

	// Check sensor readings with anti-fluctuation logic
	function checkNutrientAutoActivation(phValue, tdsValue) {
		const now = Date.now();
		
		// Update moving averages
		const avgPH = updateMovingAverage('ph', phValue);
		const avgTDS = updateMovingAverage('tds', tdsValue);
		const avgValues = { ph: avgPH, tds: avgTDS };
		
		Object.entries(NUTRIENT_THRESHOLDS).forEach(([btnId, config]) => {
			const { sensor, condition, triggerOn, triggerOff, consecutiveRequired } = config;
			const avgValue = avgValues[sensor];
			if (avgValue === undefined || isNaN(avgValue)) return;
			
			// Check if threshold is exceeded (using averaged value)
			let thresholdBreached = false;
			if (condition === 'below' && avgValue < triggerOn) {
				thresholdBreached = true;
			} else if (condition === 'above' && avgValue > triggerOn) {
				thresholdBreached = true;
			}
			
			// Check if we should deactivate (hysteresis - crossed back over triggerOff)
			let shouldDeactivate = false;
			if (nutrientActiveState[btnId]) {
				if (condition === 'below' && avgValue > triggerOff) {
					shouldDeactivate = true;
				} else if (condition === 'above' && avgValue < triggerOff) {
					shouldDeactivate = true;
				}
			}
			
			// Update consecutive breach counter
			if (thresholdBreached && !nutrientActiveState[btnId]) {
				consecutiveBreaches[btnId]++;
			} else if (!thresholdBreached || shouldDeactivate) {
				consecutiveBreaches[btnId] = 0;
				if (shouldDeactivate) {
					nutrientActiveState[btnId] = false;
					console.log(`[Hysteresis] ${btnId} deactivated: ${sensor} avg=${avgValue.toFixed(2)} crossed ${triggerOff}`);
				}
			}
			
			// Only activate if:
			// 1. Threshold breached for consecutive readings
			// 2. Cooldown period passed
			// 3. Not already in active state
			const shouldActivate = 
				consecutiveBreaches[btnId] >= consecutiveRequired &&
				!nutrientActiveState[btnId] &&
				(now - nutrientLastActivation[btnId]) > NUTRIENT_AUTO_COOLDOWN;
			
			if (shouldActivate) {
				const btn = document.getElementById(btnId);
				if (btn && !btn.disabled) {
					nutrientLastActivation[btnId] = now;
					nutrientActiveState[btnId] = true;
					consecutiveBreaches[btnId] = 0;
					
					const label = btnId === 'btn-ph-up' ? 'pH Up' : 
					              btnId === 'btn-ph-down' ? 'pH Down' : 'Leafy Green';
					console.log(`[Auto-activate] ${label}: ${sensor} avg=${avgValue.toFixed(2)} ${condition} ${triggerOn} (${consecutiveRequired} consecutive readings)`);
					
					// Disable button during pulse
					btn.disabled = true;
					btn.classList.add('is-dosing');
					
					// Pulse the relay (2 seconds ON then OFF)
					pulseNutrientRelay(btnId, label, true);
					
					// Re-enable after pulse
					setTimeout(() => {
						btn.disabled = false;
						btn.classList.remove('is-dosing');
					}, NUTRIENT_PULSE_DURATION + 500);
				}
			}
		});
	}

	function showNutrientNotification(label, isAuto = false){
		const container = document.getElementById('notificationContainer');
		if(!container) return;
		const notif = document.createElement('div');
		notif.className = 'notification neutral';
		notif.innerHTML = `
			<div class="notification-icon">💧</div>
			<div class="notification-content">
				<div class="notification-title">Nutrient Solution</div>
				<div class="notification-message">${label} ${isAuto ? '(auto)' : ''} - 2s pulse</div>
			</div>
		`;
		container.appendChild(notif);
		requestAnimationFrame(() => notif.classList.add('show'));
		setTimeout(() => {
			notif.classList.remove('show');
			setTimeout(() => notif.remove(), 300);
		}, 2500);
	}

	// Pulse a nutrient relay: ON for 2 seconds, then OFF
	async function pulseNutrientRelay(btnId, label, isAuto = false) {
		const relayNum = ACTUATOR_TO_RELAY[btnId];
		if (!relayNum) return;

		try {
			// Turn ON
			await fetch(`${RELAY_API_URL}/relay/${relayNum}/on`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			showNutrientNotification(label, isAuto);
			console.log(`Nutrient ${label} relay ${relayNum} ON`);

			// After 2 seconds, turn OFF
			setTimeout(async () => {
				await fetch(`${RELAY_API_URL}/relay/${relayNum}/off`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' }
				});
				console.log(`Nutrient ${label} relay ${relayNum} OFF`);
			}, NUTRIENT_PULSE_DURATION);
		} catch (err) {
			console.error(`Failed to pulse nutrient relay: ${err}`);
		}
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
			btn.addEventListener('click', async () => {
				if(btn.disabled) return;
				btn.disabled = true;
				btn.classList.add('is-dosing');
				btn.setAttribute('aria-pressed', 'true');
				
				// Pulse relay for 2 seconds (ON then OFF)
				await pulseNutrientRelay(action.id, action.label);
				
				// Re-enable button after pulse duration + cooldown
				setTimeout(() => {
					btn.disabled = false;
					btn.classList.remove('is-dosing');
					btn.setAttribute('aria-pressed', 'false');
				}, NUTRIENT_PULSE_DURATION + 500);
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
	
	setInterval(()=>{ drawMini('mini1'); drawMini('mini2'); drawMini('mini3'); updateSensorsAndActuators(); }, 3000);  // Poll every 3 seconds for faster updates
	
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
						<button class="row-delete-btn" title="Delete row"><img src="negativesign.png" alt="Delete"></button>
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
					<button class="row-delete-btn" title="Delete row"><img src="negativesign.png" alt="Delete"></button>
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
					<button class="row-delete-btn" title="Delete row"><img src="negativesign.png" alt="Delete"></button>
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
					<button class="row-delete-btn" title="Delete row"><img src="negativesign.png" alt="Delete"></button>
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
		showToast('Data submitted successfully!', 'success');
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

// ==================== RELAY CONTROL ====================
const RELAY_API_URL = 'https://likelihood-glucose-struck-representing.trycloudflare.com/api';

// Mapping between dashboard actuator IDs and relay numbers
const ACTUATOR_TO_RELAY = {
	'act-water': 1,        // Misting Pump
	'act-air': 2,          // Air Pump
	'act-fan-in': 3,       // Exhaust Fan (In)
	'act-fan-out': 4,      // Exhaust Fan (Out)
	'act-lights-aerponics': 5, // Grow Lights (Aeroponics)
	'act-lights-dwc': 6,   // Grow Lights (DWC)
	'btn-ph-up': 7,        // pH Up (nutrient) - GPIO 18
	'btn-ph-down': 8,      // pH Down (nutrient) - GPIO 19
	'btn-leafy-green': 9   // Leafy Green (nutrient) - GPIO 23
};

const RELAY_TO_ACTUATOR = Object.fromEntries(
	Object.entries(ACTUATOR_TO_RELAY).map(([k, v]) => [v, k])
);

async function toggleRelay(relayNum, newState, stateEl) {
	try {
		const action = newState ? 'on' : 'off';
		const response = await fetch(`${RELAY_API_URL}/relay/${relayNum}/${action}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' }
		});
		
		if (response.ok) {
			// Update Manual tab relay card
			if (stateEl) {
				stateEl.classList.remove('state-off', 'state-on');
				stateEl.classList.add(newState ? 'state-on' : 'state-off');
				stateEl.textContent = newState ? 'ON' : 'OFF';
			}
			// Also update dashboard actuator toggle if exists
			const actuatorId = RELAY_TO_ACTUATOR[relayNum];
			if (actuatorId) {
				syncActuatorUI(actuatorId, newState);
			}
		} else {
			console.error(`Failed to toggle relay ${relayNum}`);
		}
	} catch (error) {
		console.error(`Error toggling relay ${relayNum}:`, error);
	}
}

// Sync actuator UI (dashboard toggle) with relay state
function syncActuatorUI(actuatorId, state) {
	const checkbox = document.getElementById(actuatorId);
	if (!checkbox) return;
	checkbox.checked = state;
	const label = checkbox.closest('.toggle-switch');
	const toggleText = label ? label.querySelector('.toggle-text') : null;
	if (toggleText) toggleText.textContent = state ? 'ON' : 'OFF';
}

// Sync Manual tab relay card UI with state
function syncRelayCardUI(relayNum, state) {
	const card = document.querySelector(`[data-relay-id="${relayNum}"]`);
	const stateEl = card?.querySelector('.relay-state');
	if (stateEl) {
		stateEl.classList.remove('state-off', 'state-on');
		stateEl.classList.add(state ? 'state-on' : 'state-off');
		stateEl.textContent = state ? 'ON' : 'OFF';
	}
}

async function loadRelayStatus() {
	try {
		const response = await fetch(`${RELAY_API_URL}/relay/status`);
		if (response.ok) {
			const data = await response.json();
			if (data.relays) {
				data.relays.forEach(relay => {
					// Update Manual tab relay cards
					syncRelayCardUI(relay.id, relay.state);
					// Update Dashboard actuator toggles
					const actuatorId = RELAY_TO_ACTUATOR[relay.id];
					if (actuatorId) {
						syncActuatorUI(actuatorId, relay.state);
					}
				});
			}
		}
	} catch (error) {
		console.error('Error loading relay status:', error);
	}
}

// Setup relay button listeners when page loads (Manual tab)
function setupRelayButtons() {
	const relayCards = document.querySelectorAll('[data-relay-id]');
	relayCards.forEach(card => {
		const btn = card.querySelector('.relay-toggle-btn');
		if (btn) {
			btn.addEventListener('click', () => {
				const relayNum = parseInt(card.dataset.relayId);
				const stateEl = card.querySelector('.relay-state');
				const currentState = stateEl?.textContent === 'ON';
				toggleRelay(relayNum, !currentState, stateEl);
			});
		}
	});
}

// Setup dashboard actuator toggle listeners to control real relays
function setupActuatorRelayControl() {
	document.querySelectorAll('.actuator-toggle input[type="checkbox"]').forEach(checkbox => {
		checkbox.addEventListener('change', () => {
			const relayNum = ACTUATOR_TO_RELAY[checkbox.id];
			if (relayNum) {
				const newState = checkbox.checked;
				// Only send to API if override is ON (manual mode)
				const overrideToggle = document.getElementById('actuatorOverrideToggle');
				if (overrideToggle && overrideToggle.checked) {
					toggleRelay(relayNum, newState, null);
				}
			}
			// Update toggle text
			const label = checkbox.closest('.toggle-switch');
			const toggleText = label ? label.querySelector('.toggle-text') : null;
			if (toggleText) toggleText.textContent = checkbox.checked ? 'ON' : 'OFF';
		});
	});
}

// Poll relay status periodically to keep UI in sync
function startRelayStatusPolling() {
	loadRelayStatus(); // Initial load
	setInterval(loadRelayStatus, 2000); // Poll every 2 seconds
}

document.addEventListener('DOMContentLoaded', () => {
	populateRandomVoltages();
	setupRelayButtons();
	setupActuatorRelayControl();
	startRelayStatusPolling();
});


// ==================== SIMPLIFIED CALIBRATION SYSTEM ====================
(function initSimpleCalibration() {
    const API_URL = typeof RELAY_API_URL !== 'undefined' ? RELAY_API_URL : 'https://likelihood-glucose-struck-representing.trycloudflare.com/api';
    
    // State for each sensor
    const calState = {
        ph: { points: [], voltage: null },
        do: { points: [], voltage: null },
        tds: { points: [], voltage: null }
    };
    
    // Buffer values for pH
    const phBuffers = [4.00, 6.86, 9.18];
    
    // Load current calibration from API
    async function loadCalibration() {
        try {
            const res = await fetch(`${API_URL}/calibration`);
            const data = await res.json();
            
            // Update UI with current values
            for (const sensor of ['ph', 'do', 'tds']) {
                if (data[sensor]) {
                    document.getElementById(`${sensor}CurrentSlope`).textContent = data[sensor].slope?.toFixed(4) || '--';
                    document.getElementById(`${sensor}CurrentOffset`).textContent = data[sensor].offset?.toFixed(4) || '--';
                    const badge = document.getElementById(`${sensor}CalStatus`);
                    if (badge && data[sensor].slope !== 1.0) {
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
        try {
            const res = await fetch(`${API_URL}/voltage`);
            const data = await res.json();
            
            if (data.ph?.voltage !== undefined) {
                document.getElementById('phLiveVoltage').textContent = data.ph.voltage.toFixed(4) + ' V';
                calState.ph.voltage = data.ph.voltage;
            }
            if (data.do?.voltage !== undefined) {
                document.getElementById('doLiveVoltage').textContent = data.do.voltage.toFixed(4) + ' V';
                calState.do.voltage = data.do.voltage;
            }
            if (data.tds?.voltage !== undefined) {
                document.getElementById('tdsLiveVoltage').textContent = data.tds.voltage.toFixed(4) + ' V';
                calState.tds.voltage = data.tds.voltage;
            }
        } catch (e) {
            console.error('Failed to fetch voltage:', e);
        }
    }
    
    // Calculate slope and offset from captured points
    // Get DO saturation value at given temperature (mg/L)
    function getDOSaturation(tempC) {
        // Benson & Krause equation approximation for freshwater at sea level
        // https://www.waterontheweb.org/under/waterquality/oxygen.html
        const temps = [0, 5, 10, 15, 20, 25, 30, 35, 40];
        const sats = [14.6, 12.8, 11.3, 10.1, 9.1, 8.2, 7.5, 6.9, 6.4];
        
        // Linear interpolation
        if (tempC <= 0) return sats[0];
        if (tempC >= 40) return sats[sats.length - 1];
        
        for (let i = 0; i < temps.length - 1; i++) {
            if (tempC >= temps[i] && tempC < temps[i + 1]) {
                const ratio = (tempC - temps[i]) / (temps[i + 1] - temps[i]);
                return sats[i] + ratio * (sats[i + 1] - sats[i]);
            }
        }
        return 8.2; // Default 25°C
    }
    
    // Get Nernst slope at given temperature (V/pH)
    function getNernstSlope(tempC) {
        // Nernst equation: E = E0 - (RT/nF) * pH
        // At 25°C: 2.303 * R * T / F = 0.05916 V/pH
        // Temperature coefficient: slope = 0.05916 * (273.15 + T) / 298.15
        const tempK = 273.15 + tempC;
        return -0.05916 * (tempK / 298.15);
    }
    
    function calculateCalibration(sensor) {
        const points = calState[sensor].points;
        if (points.length < 1) return null;
        
        // Get temperature from input
        const tempInput = document.getElementById(`${sensor}BufferTemp`);
        const tempC = parseFloat(tempInput?.value) || 25;
        
        if (points.length === 1) {
            // 1-point: use temperature-compensated theoretical slope
            const p = points[0];
            let slope, offset;
            
            if (sensor === 'ph') {
                // Temperature-compensated Nernst slope
                slope = getNernstSlope(tempC);
                offset = p.value - (slope * p.voltage);
                console.log(`pH 1-point cal @ ${tempC}°C: Nernst slope = ${slope.toFixed(4)} V/pH`);
            } else if (sensor === 'do') {
                // Temperature-compensated DO saturation
                const doSat = getDOSaturation(tempC);
                slope = doSat / p.voltage;
                offset = 0;
                console.log(`DO 1-point cal @ ${tempC}°C: Saturation = ${doSat.toFixed(1)} mg/L`);
            } else { // tds
                slope = p.value / p.voltage;
                offset = 0;
            }
            return { slope, offset, tempC };
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
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const offset = (sumY - slope * sumX) / n;
        
        return { slope, offset, tempC };
    }
    
    // Update UI after capturing a point
    function updatePointUI(sensor, pointNum) {
        const point = calState[sensor].points.find(p => p.pointNum === pointNum);
        if (!point) return;
        
        const pointEl = document.getElementById(`${sensor}Point${pointNum}`);
        const voltageEl = document.getElementById(`${sensor}Point${pointNum}Voltage`);
        const statusEl = document.getElementById(`${sensor}Point${pointNum}Status`);
        
        if (pointEl) pointEl.classList.add('captured');
        if (voltageEl) voltageEl.textContent = point.voltage.toFixed(4);
        if (statusEl) statusEl.textContent = 'Captured';
        
        // Check if we can calculate calibration
        checkCalibrationReady(sensor);
    }
    
    // Check if enough points to enable Apply button
    function checkCalibrationReady(sensor) {
        const points = calState[sensor].points;
        const modeSelect = document.getElementById(`${sensor}PointMode`);
        const requiredPoints = parseInt(modeSelect?.value || '2');
        
        const applyBtn = document.getElementById(`${sensor}ApplyBtn`);
        const resultCard = document.getElementById(`${sensor}ResultCard`);
        
        if (points.length >= requiredPoints || (sensor !== 'ph' && points.length >= 1)) {
            // Calculate and show result
            const cal = calculateCalibration(sensor);
            if (cal) {
                document.getElementById(`${sensor}NewSlope`).textContent = cal.slope.toFixed(4);
                document.getElementById(`${sensor}NewOffset`).textContent = cal.offset.toFixed(4);
                if (resultCard) resultCard.style.display = 'block';
                if (applyBtn) applyBtn.disabled = false;
            }
        }
    }
    
    // Save calibration to API
    async function saveCalibration(sensor) {
        const cal = calculateCalibration(sensor);
        if (!cal) return;
        
        try {
            const res = await fetch(`${API_URL}/calibration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sensor, slope: cal.slope, offset: cal.offset })
            });
            
            if (res.ok) {
                // Update current values display
                document.getElementById(`${sensor}CurrentSlope`).textContent = cal.slope.toFixed(4);
                document.getElementById(`${sensor}CurrentOffset`).textContent = cal.offset.toFixed(4);
                
                const badge = document.getElementById(`${sensor}CalStatus`);
                if (badge) {
                    badge.textContent = 'Calibrated';
                    badge.classList.add('calibrated');
                }
                
                // Show success modal
                const modal = document.getElementById('calSuccessModal');
                const msg = document.getElementById('calSuccessMsg');
                if (msg) msg.textContent = `${sensor.toUpperCase()} calibration saved! Slope: ${cal.slope.toFixed(4)}, Offset: ${cal.offset.toFixed(4)}`;
                if (modal) modal.style.display = 'flex';
                
                // Clear state
                clearCalibration(sensor);
            }
        } catch (e) {
            console.error('Failed to save calibration:', e);
            alert('Failed to save calibration. Check console.');
        }
    }
    
    // Clear calibration state
    function clearCalibration(sensor) {
        calState[sensor].points = [];
        
        // Reset UI
        for (let i = 1; i <= 3; i++) {
            const pointEl = document.getElementById(`${sensor}Point${i}`);
            const voltageEl = document.getElementById(`${sensor}Point${i}Voltage`);
            const statusEl = document.getElementById(`${sensor}Point${i}Status`);
            
            if (pointEl) pointEl.classList.remove('captured');
            if (voltageEl) voltageEl.textContent = '--';
            if (statusEl) statusEl.textContent = 'Waiting';
        }
        
        const resultCard = document.getElementById(`${sensor}ResultCard`);
        const applyBtn = document.getElementById(`${sensor}ApplyBtn`);
        
        if (resultCard) resultCard.style.display = 'none';
        if (applyBtn) applyBtn.disabled = true;
    }
    
    // Setup event listeners
    function setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.calibrate-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const sensor = btn.dataset.sensor;
                
                // Update active tab
                document.querySelectorAll('.calibrate-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Show correct panel
                document.querySelectorAll('.simple-cal-panel').forEach(p => p.style.display = 'none');
                const panel = document.querySelector(`.simple-cal-panel[data-sensor-type="${sensor}"]`);
                if (panel) panel.style.display = 'flex';
            });
        });
        
        // pH point mode change
        const phModeSelect = document.getElementById('phPointMode');
        if (phModeSelect) {
            phModeSelect.addEventListener('change', () => {
                const mode = parseInt(phModeSelect.value);
                document.getElementById('phPoint3').style.display = mode >= 3 ? 'block' : 'none';
                clearCalibration('ph');
            });
        }
        
        // DO point mode change
        const doModeSelect = document.getElementById('doPointMode');
        if (doModeSelect) {
            doModeSelect.addEventListener('change', () => {
                const mode = parseInt(doModeSelect.value);
                document.getElementById('doPoint2').style.display = mode >= 2 ? 'block' : 'none';
                clearCalibration('do');
            });
        }
        
        // TDS point mode change
        const tdsModeSelect = document.getElementById('tdsPointMode');
        if (tdsModeSelect) {
            tdsModeSelect.addEventListener('change', () => {
                const mode = parseInt(tdsModeSelect.value);
                document.getElementById('tdsPoint2').style.display = mode >= 2 ? 'block' : 'none';
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
                    
                    // Remove existing point if recapturing
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
                    
                    // DO values: Point 1 = 100% saturation (8.2 mg/L at 25°C), Point 2 = 0%
                    const doValue = i === 1 ? 8.2 : 0;
                    
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
        
        // Update voltage every 2 seconds
        setInterval(fetchVoltage, 2000);
    });
})();
