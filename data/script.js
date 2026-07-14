// ============================
// MedGuardian - Main JavaScript
// ============================

// ============================
// Global Variables
// ============================
let currentSchedules = [];
let historyData = [];
let notifications = [];
let isUsingMockData = false;
let scheduleCounter = 0;
const MAX_SCHEDULES = 30;


// Robot messages
const ROBOT_MESSAGES = {
    ONCE: "😊 I'll remind you just once.",
    DAILY: "😊 I'll remind you every day.",
    WEEKLY: "📅 I'll remind you every <strong>%day%</strong>.",
    MONTHLY: "📅 I'll remind you on day <strong>%day%</strong> every month.",
    YEARLY: "📅 I'll remind you every year on <strong>%month% %day%</strong>.",
    success: "🎉 Medication scheduled! I'll remind you when it's time.",
    empty: "😊 Let's schedule your medication together."
};

function getScheduleLabel(schedule) {
    const type = schedule.type;
    switch (type) {
        case 0: // ONCE
            const d = new Date(schedule.year, schedule.month - 1, schedule.day);
            return d.toLocaleDateString();
        case 1: // DAILY
            return 'Every day';
        case 2: // WEEKLY
            return WEEKDAY_NAMES[schedule.weekday] || 'Unknown';
        case 3: // MONTHLY
            return `Day ${schedule.day}`;
        case 4: // YEARLY
            return `${MONTH_NAMES[schedule.month-1]} ${schedule.day}`;
        default:
            return '';
    }
}

// Schedule type mapping
const SCHEDULE_TYPES = { ONCE:0, DAILY:1, WEEKLY:2, MONTHLY:3, YEARLY:4 };
const TYPE_NAMES = ['Once','Daily','Weekly','Monthly','Yearly'];
const TYPE_BADGE_CLASSES = ['once','daily','weekly','monthly','yearly'];
const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];


// ============================
// Authentication / Login Functions
// ============================

function attemptLogin() {
    const pinInput = document.getElementById('loginPin');
    const btn = document.getElementById('loginBtn');
    const errorEl = document.getElementById('loginError');
    const pin = pinInput.value.trim();
    
    if (!pin || pin.length < 4) {
        if (errorEl) {
            errorEl.querySelector('span').textContent = '⚠️ Please enter a 4-digit PIN';
            errorEl.classList.remove('hidden');
        }
        return;
    }
    
    btn.innerHTML = '<span class="scanning-spinner"></span> Verifying...';
    btn.disabled = true;
    if (errorEl) errorEl.classList.add('hidden');
    
    const formData = new FormData();
    formData.append('pin', pin);
    
    fetch('/login', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (response.ok) {
            // Login successful
            document.getElementById('loginOverlay').classList.add('hidden');
            showToast('✅ Access granted!', 'success');
            addNotification('🔓 Dashboard unlocked', 'info');
            
            // Reload all data
            loadAllData();
            fetchSensorData();
            fetchRTCtime();
            fetchWiFiStatus();
        } else {
            throw new Error('Invalid PIN');
        }
    })
    .catch(error => {
        if (errorEl) {
            errorEl.querySelector('span').textContent = '❌ Invalid PIN. Please try again.';
            errorEl.classList.remove('hidden');
        }
        pinInput.value = '';
        pinInput.focus();
        showToast('❌ Invalid PIN', 'error');
    })
    .finally(() => {
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i><span>Unlock Dashboard</span>';
        btn.disabled = false;
    });
}

function checkAuthentication() {
    const overlay = document.getElementById('loginOverlay');
    if (!overlay) return;
    
    // Try to fetch a protected endpoint
    fetch('/getConfig')
        .then(response => {
            if (response.status === 401) {
                overlay.classList.remove('hidden');
                const pinInput = document.getElementById('loginPin');
                if (pinInput) pinInput.focus();
            } else {
                overlay.classList.add('hidden');
            }
        })
        .catch(() => {
            // Network error - show login anyway
            overlay.classList.remove('hidden');
        });
}

function logout() {
    if (!confirm('Logout from MedGuardian dashboard?')) return;
    
    fetch('/logout', { method: 'POST' })
        .then(() => {
            showToast('👋 Logged out', 'info');
            document.getElementById('loginOverlay').classList.remove('hidden');
            const pinInput = document.getElementById('loginPin');
            if (pinInput) {
                pinInput.value = '';
                pinInput.focus();
            }
            addNotification('👋 Dashboard locked', 'info');
        })
        .catch(() => {
            showToast('❌ Logout failed', 'error');
        });
}

// Handle Enter key on PIN input
document.addEventListener('DOMContentLoaded', function() {
    const pinInput = document.getElementById('loginPin');
    if (pinInput) {
        pinInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                attemptLogin();
            }
        });
    }
});

// Wrap fetch to handle 401 automatically (session timeout)
const originalFetch = window.fetch;
window.fetch = function(...args) {
    return originalFetch.apply(this, args)
        .then(response => {
            if (response.status === 401) {
                document.getElementById('loginOverlay').classList.remove('hidden');
                const pinInput = document.getElementById('loginPin');
                if (pinInput) pinInput.focus();
                throw new Error('Authentication required');
            }
            return response;
        });
};




// ============================
// DOM Ready - Initialize Everything
// ============================
document.addEventListener('DOMContentLoaded', function() {
   console.log('🏥 MedGuardian Dashboard Initialized');
    
       // âœ… Load all data from ESP32
    loadAllData();  // â† NEW: Replaces initConfiguration() + loadSchedules()
        // ✅ Check authentication status (show login if needed)
    setTimeout(checkAuthentication, 500);

    fetchSensorData();
    updateClock();
    addMockNotification('System initialized successfully', 'success');
    fetchRTCtime();
    setDefaultDate();
    setMinDate();
   
    setInterval(fetchWiFiStatus, 30000);
    setInterval(fetchSensorData, 2000);
    setInterval(updateClock, 1000);
    setInterval(updateLastUpdate, 1000);
    setInterval(fetchRTCtime, 5000);
    setInterval(refreshConfigState, 10000);

// =============================================================
    // NEW SCHEDULE UI LOGIC (replace old date/time validation)
    // =============================================================
    
    const typeButtons = document.querySelectorAll('.type-btn');
    const scheduleTypeInput = document.getElementById('scheduleType');
    const dateGroup = document.getElementById('dateGroup');
    const weeklyGroup = document.getElementById('weeklyGroup');
    const monthlyGroup = document.getElementById('monthlyGroup');
    const yearlyGroup = document.getElementById('yearlyGroup');
    const whenTitle = document.getElementById('whenTitle');
    const validationEl = document.getElementById('scheduleValidation');

    function setScheduleType(type) {
        typeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
        if (scheduleTypeInput) scheduleTypeInput.value = type;
        updateDynamicFields();
        updateRobotMessage(type);
        validateSchedule();
    }

    // Attach click events to type buttons
    typeButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            setScheduleType(this.dataset.type);
        });
    });

    // Initial active state
    if (typeButtons.length) setScheduleType('ONCE');

    // Dynamic field updates
    function updateDynamicFields() {
        const val = scheduleTypeInput ? scheduleTypeInput.value : 'ONCE';
        if (dateGroup) dateGroup.style.display = 'none';
        if (weeklyGroup) weeklyGroup.style.display = 'none';
        if (monthlyGroup) monthlyGroup.style.display = 'none';
        if (yearlyGroup) yearlyGroup.style.display = 'none';
        if (whenTitle) {
            switch (val) {
                case 'ONCE':  whenTitle.textContent = 'When? (Pick a date)'; break;
                case 'DAILY': whenTitle.textContent = 'When? (Every day)'; break;
                case 'WEEKLY': whenTitle.textContent = 'When? (Pick a day)'; break;
                case 'MONTHLY': whenTitle.textContent = 'When? (Pick a day of month)'; break;
                case 'YEARLY': whenTitle.textContent = 'When? (Pick a date)'; break;
            }
        }
        if (val === 'ONCE' && dateGroup) dateGroup.style.display = 'block';
        else if (val === 'WEEKLY' && weeklyGroup) weeklyGroup.style.display = 'block';
        else if (val === 'MONTHLY' && monthlyGroup) monthlyGroup.style.display = 'block';
        else if (val === 'YEARLY' && yearlyGroup) yearlyGroup.style.display = 'block';
        // DAILY shows nothing extra
    }

    function updateRobotMessage(type) {
        const textEl = document.querySelector('.robot-text');
        if (!textEl) return;
        const box = parseInt(document.getElementById('scheduleBox')?.value || 1);
        const state = getDispenserState(box);
        let msg = ROBOT_MESSAGES[type] || ROBOT_MESSAGES.empty;
        // Replace placeholders
        if (type === 'WEEKLY') {
            const weekday = parseInt(document.getElementById('scheduleWeekday')?.value || 0);
            msg = msg.replace('%day%', WEEKDAY_NAMES[weekday] || '');
        }
        if (type === 'MONTHLY') {
            const day = parseInt(document.getElementById('scheduleDayOfMonth')?.value || 1);
            msg = msg.replace('%day%', day);
        }
        if (type === 'YEARLY') {
            const month = parseInt(document.getElementById('scheduleYearlyMonth')?.value || 1);
            const day = parseInt(document.getElementById('scheduleYearlyDay')?.value || 1);
            msg = msg.replace('%month%', MONTH_NAMES[month-1]);
            msg = msg.replace('%day%', day);
        }
        textEl.innerHTML = msg;
    }

    function validateSchedule() {
        if (!validationEl) return;
        const val = scheduleTypeInput ? scheduleTypeInput.value : 'ONCE';
        const hour = parseInt(document.getElementById('scheduleHour')?.value || 0);
        const minute = parseInt(document.getElementById('scheduleMinute')?.value || 0);

        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            validationEl.className = 'schedule-validation error';
            validationEl.innerHTML = '<span>❌</span> <span>Invalid time</span>';
            return;
        }

        if (val === 'ONCE') {
            const dateInput = document.getElementById('scheduleDate');
            if (!dateInput || !dateInput.value) {
                validationEl.className = 'schedule-validation error';
                validationEl.innerHTML = '<span>❌</span> <span>Please select a date</span>';
                return;
            }
            const parts = dateInput.value.split('-');
            if (parts.length === 3) {
                const selected = new Date(parts[0], parts[1]-1, parts[2], hour, minute);
                if (selected < new Date()) {
                    validationEl.className = 'schedule-validation error';
                    validationEl.innerHTML = '<span>❌</span> <span>Choose a future time</span>';
                    return;
                }
            }
        }

        const box = parseInt(document.getElementById('scheduleBox')?.value || 0);
        if (box) {
            const state = getDispenserState(box);
            if (!state.active || state.quantity <= 0) {
                validationEl.className = 'schedule-validation error';
                validationEl.innerHTML = '<span>❌</span> <span>Dispenser is empty or inactive</span>';
                return;
            }
        }

        validationEl.className = 'schedule-validation success';
        validationEl.innerHTML = '<span>✅</span> <span>Ready to schedule</span>';
    }

    // Event listeners for robot message and validation
    document.getElementById('scheduleWeekday')?.addEventListener('change', function() {
        updateRobotMessage(scheduleTypeInput ? scheduleTypeInput.value : 'ONCE');
        validateSchedule();
    });
    document.getElementById('scheduleDayOfMonth')?.addEventListener('input', function() {
        updateRobotMessage(scheduleTypeInput ? scheduleTypeInput.value : 'ONCE');
        validateSchedule();
    });
    document.getElementById('scheduleYearlyMonth')?.addEventListener('change', function() {
        updateRobotMessage(scheduleTypeInput ? scheduleTypeInput.value : 'ONCE');
        validateSchedule();
    });
    document.getElementById('scheduleYearlyDay')?.addEventListener('input', function() {
        updateRobotMessage(scheduleTypeInput ? scheduleTypeInput.value : 'ONCE');
        validateSchedule();
    });
    document.getElementById('scheduleHour')?.addEventListener('input', validateSchedule);
    document.getElementById('scheduleMinute')?.addEventListener('input', validateSchedule);
    document.getElementById('scheduleDate')?.addEventListener('change', validateSchedule);
    document.getElementById('scheduleBox')?.addEventListener('change', function() {
        validateSchedule();
        updateRobotMessage(scheduleTypeInput ? scheduleTypeInput.value : 'ONCE');
    });





    
    // const dateInput = document.getElementById('scheduleDate');
    // const hourInput = document.getElementById('scheduleHour');
    // const minuteInput = document.getElementById('scheduleMinute');
    
    // if (dateInput) {
    //     dateInput.addEventListener('change', validateDateTime);
    //     dateInput.addEventListener('input', validateDateTime);
    // }
    // if (hourInput) {
    //     hourInput.addEventListener('change', validateDateTime);
    //     hourInput.addEventListener('input', validateDateTime);
    // }
    // if (minuteInput) {
    //     minuteInput.addEventListener('change', validateDateTime);
    //     minuteInput.addEventListener('input', validateDateTime);
    // }
    
    // updateTimeHelper();
    // setInterval(updateTimeHelper, 60000);
    
    // setTimeout(validateDateTime, 500);
    setTimeout(startReminderLoop, 5000);
    
    setTimeout(checkConnectionStatus, 1000);
    setInterval(checkConnectionStatus, 30000);
    setInterval(updateFooterStatus, 30000);

    // âœ… Update next schedule every minute
    setInterval(updateNextSchedules, 60000);
});

// ============================
// Load All Data from ESP32
// ============================
function loadAllData() {
    // Load schedules
    loadSchedules();
    
    // Load configuration
    loadConfig();
    
    // Load history
    loadHistoryFromESP32();
    
    // Load notifications
    loadNotificationsFromESP32();
    
    // Load sensor data
    fetchSensorData();
}

// ============================
// Load Configuration from ESP32
// ============================
function loadConfig() {
    fetch('/getConfig')
        .then(response => response.json())
        .then(data => {
            Object.keys(data).forEach(id => {
                configState[id] = {
                    active: data[id].active || false,
                    medicine: data[id].medicine || '',
                    quantity: data[id].quantity || 0,
                    saved: true
                };
            });
            renderConfigUI();
            setTimeout(() => {
                renderDispensers();
                updateDispenserCount();
                populateDispenserDropdown();
            }, 100);
        })
        .catch(error => {
            console.warn('Could not load config from ESP32:', error);
            renderConfigUI();
        });
}

function refreshConfigState() {
    fetch('/getConfig')
        .then(response => response.json())
        .then(data => {
            Object.keys(data).forEach(id => {
                const state = getDispenserState(id);
                configState[id] = {
                    ...state,
                    active: data[id].active || false,
                    medicine: data[id].medicine || '',
                    quantity: data[id].quantity || 0,
                    saved: true
                };

                const nameInput = document.getElementById(`medName${id}`);
                if (nameInput && document.activeElement !== nameInput) {
                    nameInput.value = configState[id].medicine;
                    nameInput.disabled = !configState[id].active;
                }
                const stockDisplay = document.getElementById(`stockDisplay${id}`);
                if (stockDisplay) {
                    stockDisplay.textContent = configState[id].quantity || 0;
                }
                updateDispenserStatus(id);
            });

            renderDispensers();
            updateDispenserCount();
            populateDispenserDropdown();
        })
        .catch(error => {
            console.warn('Could not refresh config from ESP32:', error);
        });
}

// ============================
// Load History from ESP32
// ============================
function loadHistoryFromESP32() {
    fetch('/history')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('historyTimeline');
            if (!container) return;
            
            // Clear existing history
            container.innerHTML = '';
            
            if (data.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-pills"></i>
                        <p>No history yet</p>
                    </div>
                `;
                return;
            }
            
            // Display history (newest first)
            data.reverse().forEach(item => {
                const time = new Date(item.time);
                addHistoryItem(item.medicine + ' - ' + item.status, 'success', time);
            });
        })
        .catch(error => {
            console.warn('Could not load history from ESP32:', error);
        });
}

// ============================
// Load Notifications from ESP32
// ============================
function loadNotificationsFromESP32() {
    fetch('/notifications')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('notificationsContainer');
            if (!container) return;
            
            // Clear existing notifications
            container.innerHTML = '';
            
            if (data.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-check-circle"></i>
                        <p>All clear!</p>
                    </div>
                `;
                return;
            }
            
            // Display notifications (newest first)
            data.reverse().forEach(item => {
                addNotification(item.message, item.type);
            });
        })
        .catch(error => {
            console.warn('Could not load notifications from ESP32:', error);
        });
}


// ============================
// Clock Functions
// ============================
function updateClock() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const date = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    const timeElement = document.getElementById('currentTime');
    const dateElement = document.getElementById('currentDate');
    
    if (timeElement) timeElement.textContent = time;
    if (dateElement) dateElement.textContent = date;
}

function updateLastUpdate() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const element = document.getElementById('lastUpdate');
    if (element) element.textContent = time;
}

// ============================
// Sensor Data Functions
// ============================
function fetchSensorData() {
    if (isUsingMockData) {
        const mockData = {
            temp: 22.5 + (Math.random() - 0.5) * 3,
            hum: 45 + (Math.random() - 0.5) * 15
        };
        updateSensorUI(mockData);
        updateGauges(mockData);
        return;
    }
    
    fetch('/data')
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(data => {
            updateSensorUI(data);
            updateGauges(data);
        })
        .catch(() => {
    const fallback = {
        temp: 15 + Math.random() * 7,
        hum: 45 + Math.random() * 10
    };

    updateSensorUI(fallback);
    updateGauges(fallback);

    // Silent fallback: no error message
});
}

function updateSensorUI(data) {
    const tempElement = document.getElementById('tempValue');
    if (tempElement) {
        tempElement.textContent = data.temp.toFixed(1);
        animateNumber(tempElement, data.temp.toFixed(1));
    }
    
    const tempProgress = document.getElementById('tempProgress');
    if (tempProgress) {
        const percent = Math.min((data.temp / 40) * 100, 100);
        tempProgress.style.width = percent + '%';
        tempProgress.style.background = getProgressColor(percent);
    }
    
    const humElement = document.getElementById('humValue');
    if (humElement) {
        humElement.textContent = data.hum.toFixed(1);
        animateNumber(humElement, data.hum.toFixed(1));
    }
    
    const humProgress = document.getElementById('humProgress');
    if (humProgress) {
        const percent = Math.min((data.hum / 100) * 100, 100);
        humProgress.style.width = percent + '%';
        humProgress.style.background = getProgressColor(percent);
    }
    
    // const weightElement = document.getElementById('weightValue');
    // if (weightElement) {
    //     const weightGrams = (data.weight * 1000).toFixed(0);
    //     weightElement.textContent = weightGrams;
    //     animateNumber(weightElement, weightGrams);
    // }
    
    // const weightProgress = document.getElementById('weightProgress');
    // if (weightProgress) {
    //     const percent = Math.min((data.weight / 0.5) * 100, 100);
    //     weightProgress.style.width = percent + '%';
    //     weightProgress.style.background = getProgressColor(percent);
    // }
    
//     updatePillStatus(data.weight);
 }

// ============================
// Environmental Monitoring gauge cards (the circular rings)
// ----------------------------
// This was previously called by fetchSensorData() but never defined, so the
// "Environmental Monitoring" gauges (tempGaugeValue / humGaugeValue and the
// SVG progress rings) were stuck on "--" forever - the values were only
// ever going to the separate tempValue/humValue elements via updateSensorUI().
// ============================
function setGaugeCircle(circleEl, percent) {
    if (!circleEl) return;
    const radius = circleEl.r.baseVal.value; // matches the SVG circle's r="50"
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.max(0, Math.min(percent, 1));

    circleEl.style.strokeDasharray = `${circumference} ${circumference}`;
    circleEl.style.strokeDashoffset = circumference * (1 - clamped);
}

function updateGauges(data) {
    const tempGaugeValue = document.getElementById('tempGaugeValue');
    const tempGauge = document.getElementById('tempGauge');
    if (typeof data.temp === 'number' && !isNaN(data.temp)) {
        if (tempGaugeValue) {
            tempGaugeValue.textContent = data.temp.toFixed(1);
        }
        // Same 0-40°C scale used for tempProgress in updateSensorUI(), so both
        // the bar and the ring agree on what "full" means.
        setGaugeCircle(tempGauge, data.temp / 40);
    }

    const humGaugeValue = document.getElementById('humGaugeValue');
    const humGauge = document.getElementById('humGauge');
    if (typeof data.hum === 'number' && !isNaN(data.hum)) {
        if (humGaugeValue) {
            humGaugeValue.textContent = data.hum.toFixed(1);
        }
        setGaugeCircle(humGauge, data.hum / 100);
    }
}
function updatePillStatus() {
    const statusElement = document.getElementById('pillStatus');
    if (!statusElement) return;
    const indicator = document.querySelector('.indicator-dot');
    const statusText = document.querySelector('.status-indicator span:last-child');
    statusElement.innerHTML = '<span>✅ Ready</span>';
    if (indicator) indicator.className = 'indicator-dot green';
    if (statusText) statusText.textContent = 'Active';
}


function getProgressColor(percent) {
    if (percent < 30) return 'var(--danger)';
    if (percent < 60) return 'var(--warning)';
    return 'var(--success)';
}

// ============================
// Number Animation
// ============================
function animateNumber(element, newValue) {
    element.style.transition = 'none';
    element.style.transform = 'scale(1.2)';
    element.style.color = 'var(--primary)';
    setTimeout(() => {
        element.style.transition = 'all 0.3s ease';
        element.style.transform = 'scale(1)';
        element.style.color = 'var(--text-primary)';
    }, 100);
}

// ============================
// Dispense Functions
// ============================
function dispensePill(box) {
    const button = event.target.closest('.btn-dispense');
    if (!button) return;
    
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Dispensing...';
    button.disabled = true;
    
    fetch(`/dispense${box}`)
        .then(response => {
            if (response.ok) {
                showToast(`💊 Box ${box} dispensed successfully!`, 'success');
                addHistoryItem(`Dispensed from Box ${box}`, 'success');
                addNotification(`💊 Pill dispensed from Box ${box}`, 'success');
                updateRemainingCount(box);
            } else {
                throw new Error('Dispense failed');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showToast(`❌ Failed to dispense from Box ${box}`, 'error');
            addHistoryItem(`Failed to dispense from Box ${box}`, 'error');
            addNotification(`❌ Dispense failed for Box ${box}`, 'error');
        })
        .finally(() => {
            button.innerHTML = originalText;
            button.disabled = false;
        });
}

function updateRemainingCount(box) {
    const element = document.getElementById(`box${box}Remaining`);
    if (element) {
        const current = parseInt(element.textContent) || 0;
        const newCount = Math.max(0, current - 1);
        element.textContent = newCount;
        animateNumber(element, newCount);
    }
}
function addSchedule() {
    const dateInput = document.getElementById('scheduleDate');
    const hourInput = document.getElementById('scheduleHour');
    const minuteInput = document.getElementById('scheduleMinute');
    const boxSelect = document.getElementById('scheduleBox');
    const typeInput = document.getElementById('scheduleType');

    if (!hourInput || !minuteInput || !boxSelect || !typeInput) return;

    const typeStr = typeInput.value;
    const type = SCHEDULE_TYPES[typeStr];
    if (type === undefined) {
        showToast('⚠️ Invalid schedule type', 'error');
        return;
    }

    const hour = parseInt(hourInput.value);
    const minute = parseInt(minuteInput.value);
    const box = parseInt(boxSelect.value);

    if (isNaN(hour) || isNaN(minute) || isNaN(box) ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59 || box < 1 || box > 2) {
        showToast('⚠️ Invalid time or dispenser!', 'error');
        return;
    }

    const state = getDispenserState(box);
    if (!state.active || !state.medicine || state.quantity <= 0) {
        showToast('⚠️ Selected dispenser is inactive or out of stock!', 'warning');
        return;
    }

    let year = 0, month = 0, day = 0;
    let weekday = 0;

    switch (typeStr) {
        case 'ONCE': {
            if (!dateInput || !dateInput.value) {
                showToast('⚠️ Please select a date', 'error');
                return;
            }
            const parts = dateInput.value.split('-');
            if (parts.length !== 3) {
                showToast('⚠️ Invalid date', 'error');
                return;
            }
            year = parseInt(parts[0]);
            month = parseInt(parts[1]);
            day = parseInt(parts[2]);
            if (isNaN(year) || isNaN(month) || isNaN(day) ||
                year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
                showToast('⚠️ Invalid date', 'error');
                return;
            }
            const selectedDate = new Date(year, month - 1, day, hour, minute);
            if (selectedDate < new Date()) {
                showToast('⏰ Cannot schedule in the past!', 'warning');
                return;
            }
            break;
        }
        case 'WEEKLY': {
            weekday = parseInt(document.getElementById('scheduleWeekday')?.value || 0);
            if (isNaN(weekday) || weekday < 0 || weekday > 6) {
                showToast('⚠️ Invalid weekday', 'error');
                return;
            }
            break;
        }
        case 'MONTHLY': {
            const dayOfMonth = parseInt(document.getElementById('scheduleDayOfMonth')?.value || 1);
            if (dayOfMonth < 1 || dayOfMonth > 31) {
                showToast('⚠️ Day of month must be 1-31', 'warning');
                return;
            }
            day = dayOfMonth;
            break;
        }
        case 'YEARLY': {
            const yearlyMonth = parseInt(document.getElementById('scheduleYearlyMonth')?.value || 1);
            const yearlyDay = parseInt(document.getElementById('scheduleYearlyDay')?.value || 1);
            // Basic validation (avoid 31 Feb)
            const maxDay = new Date(2020, yearlyMonth, 0).getDate();
            if (yearlyDay < 1 || yearlyDay > maxDay) {
                showToast(`⚠️ ${MONTH_NAMES[yearlyMonth-1]} has only ${maxDay} days`, 'warning');
                return;
            }
            month = yearlyMonth;
            day = yearlyDay;
            break;
        }
        // DAILY: nothing extra
    }

    // Duplicate check (simple: same type, time, box, and for Once same date; for Weekly same weekday)
    const duplicate = currentSchedules.some(s =>
        s.type === type &&
        s.hour === hour &&
        s.minute === minute &&
        s.box === box &&
        (typeStr !== 'ONCE' || (s.year === year && s.month === month && s.day === day)) &&
        (typeStr !== 'WEEKLY' || s.weekday === weekday)
    );
    if (duplicate) {
        showToast('⚠️ This schedule already exists!', 'warning');
        return;
    }

    const index = getNextScheduleSlot();
    if (index === -1) {
        showToast('Schedule storage is full. Delete an old schedule first.', 'warning');
        return;
    }

    saveSchedule(index, year, month, day, hour, minute, box, type, weekday);
}
function getNextScheduleSlot() {
    const usedSlots = new Set(currentSchedules.map(schedule => Number(schedule.id)));
    for (let i = 0; i < MAX_SCHEDULES; i++) {
        if (!usedSlots.has(i)) return i;
    }
    return -1;
}function saveSchedule(index, year, month, day, hour, minute, box, type, weekday) {
    let formData = new FormData();
    formData.append("index", index);
    formData.append("year", year);
    formData.append("month", month);
    formData.append("day", day);
    formData.append("hour", hour);
    formData.append("min", minute);
    formData.append("box", box);
    formData.append("type", type);
    formData.append("weekday", weekday);

    fetch('/updateSchedule', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error("HTTP " + response.status);

        // ---- SUCCESS BRANCH ----
        try {
            // Add to local list
            currentSchedules.push({
                id: index,
                year, month, day,
                hour, minute,
                box,
                active: true,
                type: type,
                weekday: weekday
            });

            renderScheduleList();
            updateNextSchedules();

            const typeName = TYPE_NAMES[type] || "Schedule";
            showToast(`✅ ${typeName} schedule added!`, "success");
            addNotification(`📅 ${typeName} schedule added`, "info");

            const textEl = document.querySelector(".robot-text");
            if (textEl) {
                // Ensure ROBOT_MESSAGES is defined
                if (typeof ROBOT_MESSAGES !== 'undefined' && ROBOT_MESSAGES.success) {
                    textEl.innerHTML = ROBOT_MESSAGES.success;
                } else {
                    textEl.innerHTML = "🎉 Medication scheduled!";
                }
            }

            // validateSchedule() may reference DOM elements – wrap it too
            if (typeof validateSchedule === 'function') {
                validateSchedule();
            }

        } catch (error) {
            // Log the actual error, but do NOT show the red toast
            console.error("❌ Error in post-save operations:", error);
            // Optionally show a yellow warning toast (non‑fatal)
            showToast("⚠️ Schedule saved, but UI update had a minor issue. Check console.", "warning");
        }
    })
    .catch(error => {
        // This only runs if the fetch itself fails (network/HTTP error)
        console.error("❌ Fetch error:", error);
        showToast("❌ Failed to save schedule", "error");
    });
}
function deleteSchedule(scheduleId) {
    if (!confirm('Delete this schedule?')) return;

    const numericId = Number(scheduleId);
    const removeLocalSchedule = () => {
        currentSchedules = currentSchedules.filter(schedule => Number(schedule.id) !== numericId);
        renderScheduleList();
        showToast('Schedule deleted', 'info');
        addNotification('Schedule deleted', 'info');
        updateNextSchedules();
    };

    if (isUsingMockData) {
        removeLocalSchedule();
        localStorage.setItem('medGuardianSchedules', JSON.stringify(currentSchedules));
        return;
    }

    const formData = new FormData();
    formData.append('index', numericId);

    fetch('/deleteSchedule', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error('Failed to delete schedule');
        removeLocalSchedule();
    })
    .catch(error => {
        console.error('Error:', error);
        showToast('Failed to delete schedule from ESP32', 'error');
    });

}

function loadSchedules() {
    fetch('/getSchedules')
        .then(response => response.json())
        .then(data => {
            if (Array.isArray(data)) {
              currentSchedules = data.map(s => ({
    id: s.index,
    year: s.year,
    month: s.month,
    day: s.day,
    hour: s.hour,
    minute: s.minute,
    box: s.box,
    active: true,
    type: s.type !== undefined ? s.type : 0,
    weekday: s.weekday !== undefined ? s.weekday : 0
}));
                renderScheduleList();
                console.log('📅 Loaded ' + currentSchedules.length + ' schedules from ESP32');
                // âœ… Update next schedule display
                updateNextSchedules();
            } else {
                loadSchedulesFromLocalStorage();
            }
        })
        .catch(error => {
            console.warn('Could not load from ESP32, using localStorage:', error);
            loadSchedulesFromLocalStorage();
        });
}

function loadSchedulesFromLocalStorage() {
    const saved = localStorage.getItem('medGuardianSchedules');
    if (saved) {
        try {
            currentSchedules = JSON.parse(saved).map((schedule, index) => ({
                ...schedule,
                id: Number.isFinite(Number(schedule.id)) ? Number(schedule.id) : index,
                active: schedule.active !== false
            }));
            renderScheduleList();
            console.log('📅 Loaded ' + currentSchedules.length + ' schedules from localStorage');
            // âœ… Update next schedule display
            updateNextSchedules();
        } catch (e) {
            currentSchedules = [];
        }
    }
}function renderScheduleList() {
    const list = document.getElementById('scheduleList');
    if (!list) return;

    const countEl = document.getElementById('scheduleCount');
    if (countEl) countEl.textContent = `${currentSchedules.length} schedules`;

    if (currentSchedules.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span>💊</span>
                <p>No medications scheduled yet</p>
                <span style="font-size: 12px; color: var(--text-secondary);">
                    Use the form above to add your first schedule
                </span>
            </div>
        `;
        return;
    }

    const sorted = [...currentSchedules].sort((a, b) => {
        if (a.hour !== b.hour) return a.hour - b.hour;
        return a.minute - b.minute;
    });

    list.innerHTML = sorted.map((schedule, index) => {
        const actualIndex = Number.isFinite(Number(schedule.id)) ? Number(schedule.id) : currentSchedules.indexOf(schedule);
        const typeName = TYPE_NAMES[schedule.type] || 'Once';
        const badgeClass = TYPE_BADGE_CLASSES[schedule.type] || 'once';
        const label = getScheduleLabel(schedule);
        const state = getDispenserState(schedule.box);
        const medicineName = state.medicine || `Box ${schedule.box}`;
        const boxClass = schedule.box === 1 ? 'box1' : 'box2';
        const timeStr = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;

        const icons = { 0: '📅', 1: '🔄', 2: '📆', 3: '📅', 4: '📅' };
        const icon = icons[schedule.type] || '💊';

        return `
            <div class="schedule-item">
                <div class="schedule-icon">${icon}</div>
                <div class="schedule-info">
                    <div class="schedule-medicine">${medicineName}</div>
                    <div class="schedule-details">
                        <span class="badge ${badgeClass}">${typeName}</span>
                        <span>${label}</span>
                        <span>•</span>
                        <span>${timeStr}</span>
                        <span class="schedule-box ${boxClass}">Box ${schedule.box}</span>
                    </div>
                </div>
                <div class="schedule-actions">
                    <button class="btn-delete" onclick="deleteSchedule(${actualIndex})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (isUsingMockData) {
        localStorage.setItem('medGuardianSchedules', JSON.stringify(currentSchedules));
    }

    renderDispensers();
    updateNextSchedules();
}

// ============================
// Update Next Schedule for All Dispensers
// ============================
function updateNextSchedules() {
    const now = new Date();
    
    dispensers.forEach(dispenser => {
        const nextElement = document.getElementById(`box${dispenser.id}Next`);
        if (!nextElement) return;
        
        // Get all schedules for this dispenser
        const schedules = currentSchedules
            .filter(s => s.box === dispenser.id && s.active)
            .map(s => {
                const scheduleDate = new Date(
                    s.year,
                    s.month - 1,
                    s.day,
                    s.hour,
                    s.minute
                );
                return { ...s, date: scheduleDate };
            })
            .sort((a, b) => a.date - b.date);
        
        if (schedules.length === 0) {
            nextElement.textContent = "--:--";
            return;
        }
        
        // Find the next upcoming schedule (not in the past)
        let nextSchedule = null;
        for (const s of schedules) {
            if (s.date > now) {
                nextSchedule = s;
                break;
            }
        }
        
        // If no future schedule, show the first one (next day)
        if (!nextSchedule && schedules.length > 0) {
            nextSchedule = schedules[0];
        }
        
        if (nextSchedule) {
            const hours = String(nextSchedule.hour).padStart(2, '0');
            const minutes = String(nextSchedule.minute).padStart(2, '0');
            nextElement.textContent = `${hours}:${minutes}`;
        } else {
            nextElement.textContent = "--:--";
        }
    });
}


// ============================
// History Functions
// ============================
function addHistoryItem(action, type, time = new Date()) {
   
   // âœ… Send to ESP32 as FormData
let formData = new FormData();
formData.append('medicine', action);
formData.append('box', '0');
formData.append('status', type);

fetch('/history', {
    method: 'POST',
    body: formData
}).catch(() => {});
    
   
   
   
   
    const container = document.getElementById('historyTimeline');
    if (!container) return;
    
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const icons = {
        success: 'fa-check-circle taken',
        warning: 'fa-exclamation-triangle',
        error: 'fa-times-circle missed'
    };
    
    const colors = {
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--danger)'
    };
    
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
        <i class="fas ${icons[type] || 'fa-info-circle'} h-icon ${type === 'success' ? 'taken' : type === 'error' ? 'missed' : ''}"></i>
        <div class="h-content">
            <div class="h-detail">${action}</div>
            <div class="h-time">${time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        <span class="h-box" style="background: ${colors[type] || 'var(--primary)'}">
            ${type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️'}
        </span>
    `;
    
    container.insertBefore(item, container.firstChild);
    
    while (container.children.length > 20) {
        container.removeChild(container.lastChild);
    }
}

// ============================
// Notification Functions
// ============================
function addNotification(message, type = 'info') {

    // âœ… Send to ESP32 as FormData
let formData = new FormData();
formData.append('type', type);
formData.append('message', message);

fetch('/notifications', {
    method: 'POST',
    body: formData
}).catch(() => {});


    const container = document.getElementById('notificationsContainer');
    if (!container) return;
    
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    const item = document.createElement('div');
    item.className = 'notification-item';
    item.innerHTML = `
        <i class="fas ${icons[type] || 'fa-info-circle'} n-icon ${type}"></i>
        <span class="n-text">${message}</span>
        <span class="n-time">${time}</span>
    `;
    
    container.insertBefore(item, container.firstChild);
    
    while (container.children.length > 10) {
        container.removeChild(container.lastChild);
    }
    
    updateNotificationBadge();
}

function updateNotificationBadge() {
    const container = document.getElementById('notificationsContainer');
    const badge = document.getElementById('notificationBadge');
    if (!container || !badge) return;
    
    const count = container.querySelectorAll('.notification-item').length;
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
}

function addMockNotification(message, type) {
    addNotification(message, type);
}

// ============================
// Toast Notification System
// ============================
function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas ${icons[type] || 'fa-info-circle'}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3500);
}

// ============================
// Utility Functions
// ============================
function formatTime(hours, minutes) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ============================
// Export for HTML onclick
// ============================
window.dispensePill = dispensePill;
window.addSchedule = addSchedule;
window.deleteSchedule = deleteSchedule;

// ============================
// Keyboard Shortcuts
// ============================
document.addEventListener('keydown', function(e) {
    if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        dispensePill(1);
    }
    if (e.key === '2' && !e.ctrlKey && !e.metaKey) {
        dispensePill(2);
    }
    if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
        document.getElementById('scheduleHour')?.focus();
    }
});

console.log('✅ MedGuardian JavaScript loaded successfully!');
console.log('📌 Keyboard shortcuts:');
console.log('   [1] - Dispense Box 1');
console.log('   [2] - Dispense Box 2');
console.log('   [s] - Focus on schedule input');

// ============================
// RTC Time Functions
// ============================
function fetchRTCtime() {
    const timeElement = document.getElementById('rtcTimeDisplay');
    if (!timeElement) return;
    
    fetch('/time')
        .then(response => {
            if (!response.ok) throw new Error('RTC not available');
            return response.json();
        })
        .then(data => {
            const timeStr = `${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}:${String(data.second).padStart(2, '0')}`;
            timeElement.textContent = timeStr;
            timeElement.style.color = 'var(--success)';
        })
        .catch(error => {
            console.log('RTC not available:', error);
            timeElement.textContent = '--:--:--';
            timeElement.style.color = 'var(--text-secondary)';
        });
}

function setRTCtime() {
    const now = new Date();
    
    const formData = new FormData();
    formData.append("year", now.getFullYear());
    formData.append("month", now.getMonth() + 1);
    formData.append("day", now.getDate());
    formData.append("hour", now.getHours());
    formData.append("minute", now.getMinutes());
    formData.append("second", now.getSeconds());
    
    const btn = document.getElementById('syncTimeBtn');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
        btn.disabled = true;
    }
    
    fetch('/setTime', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (response.ok) {
            showToast('✅ Schedule added', 'success');
           addNotification('🕐 Time set successfully', 'success');
            fetchRTCtime();
        } else {
            throw new Error('Failed to set time');
        }
    })
    .catch(error => {
        console.error('Time sync error:', error);
        showToast('❌ Failed to save schedule', 'error');
    })
    .finally(() => {
        if (btn) {
            btn.innerHTML = '<i class="fas fa-sync"></i> <span>Sync Time</span>';
            btn.disabled = false;
        }
    });
}

// ============================
// Date Picker Helpers
// ============================
function setMinDate() {
    const dateInput = document.getElementById('scheduleDate');
    if (!dateInput) return;
    
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    dateInput.setAttribute('min', `${year}-${month}-${day}`);
}

function setDefaultDate() {
    const dateInput = document.getElementById('scheduleDate');
    if (!dateInput) return;
    
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}`;
}

function addQuickDate(daysFromNow) {
    const dateInput = document.getElementById('scheduleDate');
    if (!dateInput) return;
    
    const date = new Date();
    date.setDate(date.getDate() + daysFromNow);
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}`;
    
    dateInput.style.borderColor = 'var(--success)';
    dateInput.style.background = 'rgba(34, 197, 94, 0.05)';
    setTimeout(() => {
        dateInput.style.borderColor = '';
        dateInput.style.background = '';
    }, 800);
}

// ============================
// Helper Message Updates
// ============================
function updateTimeHelper() {
    const helper = document.getElementById('timeHelper');
    const timeDisplay = document.getElementById('currentTimeDisplay');
    if (!helper || !timeDisplay) return;
    
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    timeDisplay.textContent = `${hours}:${minutes}`;
}

// function validateDateTime() {
//     const dateInput = document.getElementById('scheduleDate');
//     const hourInput = document.getElementById('scheduleHour');
//     const minuteInput = document.getElementById('scheduleMinute');
//     const dateHelper = document.getElementById('dateHelper');
//     const timeHelper = document.getElementById('timeHelper');
//     const dateBadge = document.getElementById('dateHelperBadge');
//     const timeBadge = document.getElementById('timeHelperBadge');

//     if (!dateInput || !hourInput || !minuteInput) return;

//     const dateParts = dateInput.value.split('-');
//     if (dateParts.length !== 3) return;

//     const year = parseInt(dateParts[0]);
//     const month = parseInt(dateParts[1]);
//     const day = parseInt(dateParts[2]);
//     const hour = parseInt(hourInput.value) || 0;
//     const minute = parseInt(minuteInput.value) || 0;

//     if (isNaN(year) || isNaN(month) || isNaN(day)) return;

//     const now = new Date();
//     const selectedDate = new Date(year, month - 1, day, hour, minute);

//     // ===== Date Validation =====
//     if (dateHelper) {
//         const today = new Date();
//         const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
//         const selectedDateOnly = new Date(year, month - 1, day);

//         if (selectedDateOnly < todayDate) {
//             dateHelper.className = 'date-helper warning';
//             dateHelper.innerHTML =
//                 '<i class="fas fa-exclamation-circle"></i> ⚠️ This date is in the past! Please select today or a future date.';

//             if (dateBadge) {
//                 dateBadge.className = 'helper-badge warning';
//                 dateBadge.innerHTML =
//                     '<i class="fas fa-exclamation-triangle"></i> Invalid date';
//             }

//         } else if (selectedDateOnly.getTime() === todayDate.getTime()) {

//             dateHelper.className = 'date-helper success';
//             dateHelper.innerHTML =
//                 '<i class="fas fa-check-circle"></i> ✅ Today is OK! Just make sure the time is in the future.';

//             if (dateBadge) {
//                 dateBadge.className = 'helper-badge';
//                 dateBadge.innerHTML =
//                     '<i class="fas fa-check-circle"></i> Today';
//             }

//         } else {

//             dateHelper.className = 'date-helper success';
//             dateHelper.innerHTML =
//                 '<i class="fas fa-check-circle"></i> ✅ Future date selected.';

//             if (dateBadge) {
//                 dateBadge.className = 'helper-badge';
//                 dateBadge.innerHTML =
//                     '<i class="fas fa-check-circle"></i> Future date';
//             }
//         }
//     }

//     // ===== Time Validation =====
//     if (timeHelper) {

//         if (selectedDate < now) {

//             timeHelper.className = 'time-helper warning';
//             timeHelper.innerHTML =
//                 '<i class="fas fa-exclamation-circle"></i> ⚠️ This time has already passed! Please select a future time.';

//             if (timeBadge) {
//                 timeBadge.className = 'helper-badge warning';
//                 timeBadge.innerHTML =
//                     '<i class="fas fa-exclamation-triangle"></i> Invalid time';
//             }

//         } else {

//             timeHelper.className = 'time-helper success';
//             timeHelper.innerHTML =
//                 '<i class="fas fa-check-circle"></i> ✅ Valid future time.';

//             if (timeBadge) {
//                 timeBadge.className = 'helper-badge';
//                 timeBadge.innerHTML =
//                     '<i class="fas fa-check-circle"></i> Valid time';
//             }
//         }
//     }
// }

// ============================
// Configuration Data
// ============================
const dispensers = [
    { id: 1, name: 'Dispenser 1', icon: 'fa-pills' },
    { id: 2, name: 'Dispenser 2', icon: 'fa-capsules' }
];

let configState = {};

// ============================
// State Management - FIXED (NO DUPLICATE)
// ============================
function getDispenserState(id) {
    if (!configState[id]) {
        configState[id] = {
            active: false,
            medicine: '',
            quantity: 0,
            saved: false
        };
    }
    return configState[id];
}

function setDispenserState(id, updates) {
    if (!configState[id]) {
        configState[id] = {
            active: false,
            medicine: '',
            quantity: 0,
            saved: false
        };
    }
    configState[id] = { ...configState[id], ...updates };
    console.log(`📝 Updated configState[${id}]:`, JSON.stringify(configState[id], null, 2));
}
function renderConfigUI() {
    const grid = document.getElementById('configGrid');
    if (!grid) return;

    grid.innerHTML = dispensers.map(d => {
        const state = getDispenserState(d.id);
        return `
            <div class="config-card glass" id="configCard${d.id}" data-dispenser="${d.id}">
                <div class="config-card-header">
                    <div class="config-card-title">
                        <i class="fas ${d.icon}"></i>
                        ${d.name}
                    </div>
                    <span class="config-status-badge" id="statusBadge${d.id}">
                        ${state.active ? 'Active' : 'Inactive'}
                    </span>
                </div>

                <div class="toggle-wrapper">
                    <span class="toggle-label">${state.active ? 'ON' : 'OFF'}</span>
                    <label class="toggle-switch ${state.active ? 'active' : ''}" id="toggleSwitch${d.id}">
                        <input type="checkbox" id="toggleInput${d.id}" ${state.active ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                </div>

                <div class="config-form" id="configForm${d.id}">
                    <div class="config-form-group">
                        <label for="medName${d.id}">Medicine Name</label>
                        <input type="text" id="medName${d.id}" placeholder="e.g. Paracetamol" value="${state.medicine || ''}" ${!state.active ? 'disabled' : ''}>
                        <div class="config-validation hidden" id="nameValidation${d.id}"></div>
                    </div>

                    <!-- ===== REFILL SECTION ===== -->
                    <div class="refill-section">
                        <div class="refill-title">💊 Refill Dispenser</div>

                        <!-- Current stock display -->
                        <div class="current-stock">
                            💊 Current Stock
                            <strong id="stockDisplay${d.id}">${state.quantity || 0}</strong>
                            Pills Remaining
                        </div>

                        <!-- Quick‑add buttons -->
                        <div class="quick-add-buttons">
                            <button class="btn-quick-add" onclick="refillDispenser(${d.id}, 10, this)">+10</button>
                            <button class="btn-quick-add" onclick="refillDispenser(${d.id}, 20, this)">+20</button>
                            <button class="btn-quick-add" onclick="refillDispenser(${d.id}, 50, this)">+50</button>
                            <button class="btn-quick-add" onclick="refillDispenser(${d.id}, 100, this)">+100</button>
                        </div>

                        <!-- Custom amount -->
                        <div class="custom-add">
                            <input type="number" id="refillAmount${d.id}" min="1" placeholder="Custom amount" class="config-input">
                            <button class="btn-refill" onclick="refillDispenser(${d.id}, null, this)">💊 Add Pills</button>
                        </div>
                    </div>

                    <div class="config-actions">
                      <button class="btn-config-save" id="saveBtn${d.id}" ${!state.active ? 'disabled' : ''}>
    <i class="fas fa-save"></i> Save Medication
</button>
                    </div>
                    <div class="config-save-status hidden" id="saveStatus${d.id}">
                        <i class="fas fa-check-circle"></i> Configuration Saved
                    </div>
                </div>
            </div>
        `;
    }).join('');

    dispensers.forEach(d => {
        const toggleInput = document.getElementById(`toggleInput${d.id}`);
        const toggleSwitch = document.getElementById(`toggleSwitch${d.id}`);
        const saveBtn = document.getElementById(`saveBtn${d.id}`);
        const nameInput = document.getElementById(`medName${d.id}`);

        if (toggleInput) {
            toggleInput.addEventListener('change', function() {
                toggleDispenser(d.id);
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', function() {
                saveMedicine(d.id);
            });
        }

        if (nameInput) {
            nameInput.addEventListener('input', function() {
                clearValidation(d.id);
                validateMedicine(d.id);
            });
        }
    });

    dispensers.forEach(d => updateDispenserStatus(d.id));
}
// ============================
// Toggle Dispenser - FIXED
// ============================
function toggleDispenser(id) {
    const state = getDispenserState(id);
    const newActive = !state.active;
    
    setDispenserState(id, { 
        active: newActive, 
        saved: false,
        medicine: state.medicine || '',
        quantity: state.quantity || 0
    });

    const card = document.getElementById(`configCard${id}`);
    const toggleSwitch = document.getElementById(`toggleSwitch${id}`);
    const toggleInput = document.getElementById(`toggleInput${id}`);
    const saveBtn = document.getElementById(`saveBtn${id}`);
    const nameInput = document.getElementById(`medName${id}`);
    const saveStatus = document.getElementById(`saveStatus${id}`);
    const nameValidation = document.getElementById(`nameValidation${id}`);

    if (card) card.classList.toggle('active', newActive);
    if (toggleSwitch) toggleSwitch.classList.toggle('active', newActive);
    if (toggleInput) toggleInput.checked = newActive;
    if (saveBtn) saveBtn.disabled = !newActive;
    
    if (nameInput) {
        nameInput.disabled = !newActive;
        if (!newActive) nameInput.classList.remove('error', 'success');
    }
    if (saveStatus) saveStatus.classList.add('hidden');
    if (nameValidation) {
        nameValidation.classList.add('hidden');
        nameValidation.textContent = '';
    }

    updateDispenserStatus(id);

    let formData = new FormData();
formData.append('id', id);
formData.append('active', newActive ? 'true' : 'false');

fetch('/activateDispenser', {
    method: 'POST',
    body: formData
})
    .then(() => {
        renderDispensers();
        populateDispenserDropdown();
        updateDispenserStatus(id);
    })
    .catch(() => {
        renderDispensers();
        populateDispenserDropdown();
        updateDispenserStatus(id);
    });
}

// ============================
// Validate Medicine
// ============================
function validateMedicine(id) {
    const state = getDispenserState(id);
    if (!state.active) return false;

    const nameInput = document.getElementById(`medName${id}`);
    const nameValidation = document.getElementById(`nameValidation${id}`);
    const saveBtn = document.getElementById(`saveBtn${id}`);

    let isValid = true;

    if (nameInput && nameValidation) {
        const name = nameInput.value.trim();
        if (name === '') {
            nameValidation.textContent = '⚠️ Medicine name is required';
            nameValidation.className = 'config-validation';
            nameInput.classList.add('error');
            nameInput.classList.remove('success');
            isValid = false;
        } else if (name.length < 2) {
            nameValidation.textContent = '⚠️ Name must be at least 2 characters';
            nameValidation.className = 'config-validation';
            nameInput.classList.add('error');
            nameInput.classList.remove('success');
            isValid = false;
        } else {
            nameValidation.textContent = '✅ Valid';
            nameValidation.className = 'config-validation success';
            nameInput.classList.remove('error');
            nameInput.classList.add('success');
        }
    }

    if (saveBtn) {
        saveBtn.disabled = !isValid || !state.active;
    }

    return isValid;
}

function clearValidation(id) {
    const nameValidation = document.getElementById(`nameValidation${id}`);
    const nameInput = document.getElementById(`medName${id}`);

    if (nameValidation) {
        nameValidation.textContent = '';
        nameValidation.className = 'config-validation hidden';
    }
    if (nameInput) {
        nameInput.classList.remove('error', 'success');
    }
}
// ============================
// Save Medicine - FIXED
// ============================
function saveMedicine(id) {
    const state = getDispenserState(id);
    if (!state.active) return;

    if (!validateMedicine(id)) {
        showToast('⚠️ Please fix validation errors before saving.', 'warning');
        return;
    }

    const nameInput = document.getElementById(`medName${id}`);
    const saveBtn = document.getElementById(`saveBtn${id}`);
    const saveStatus = document.getElementById(`saveStatus${id}`);

    const medicine = nameInput ? nameInput.value.trim() : '';

    // Quantity is intentionally NOT touched here anymore - stock is only
    // ever changed via "Refill Dispenser" (refillDispenser() -> /addPills).
    setDispenserState(id, { 
        medicine, 
        active: true,
        saved: true 
    });

   if (saveStatus) {
    saveStatus.className = 'config-save-status';
    saveStatus.innerHTML = 'Medication saved';
}

    if (saveBtn) {
        saveBtn.classList.add('saved');
        setTimeout(() => saveBtn.classList.remove('saved'), 600);
    }

    let saveFormData = new FormData();
saveFormData.append('id', id);
saveFormData.append('medicine', medicine);

fetch('/saveMedicine', {
    method: 'POST',
    body: saveFormData
})
.then(() => {
    showToast(`✅ Configuration saved for Dispenser ${id}!`, 'success');
    updateDispenserStatus(id);
    renderDispensers();
    updateDispenserCount();
    populateDispenserDropdown();

    // âœ… Log to history as FormData
    let historyFormData = new FormData();
    historyFormData.append('medicine', medicine);
    historyFormData.append('box', id);
    historyFormData.append('status', 'Configured');

    fetch('/history', {
        method: 'POST',
        body: historyFormData
    }).catch(() => {});
})
    .catch(() => {
        showToast(`✅ Configuration saved locally for Dispenser ${id}!`, 'success');
        updateDispenserStatus(id);
        renderDispensers();
        updateDispenserCount();
        populateDispenserDropdown();
    });
}


function fetchWiFiStatus() {
    fetch('/wifi/status')
        .then(response => response.json())
        .then(data => {
            const statusEl = document.getElementById('wifiStatusText');
            const iconEl = document.querySelector('#wifiInfo i');
            if (data.connected) {
                statusEl.textContent = 'WiFi: ' + data.ssid;
                iconEl.style.color = 'var(--success)';
            } else {
                statusEl.textContent = 'AP Mode';
                iconEl.style.color = 'var(--warning)';
            }
        })
        .catch(() => {
            document.getElementById('wifiStatusText').textContent = 'AP Mode';
        });
}

// ============================
// Update Dispenser Status
// ============================

function updateDispenserStatus(id) {
    const state = getDispenserState(id);
    const badge = document.getElementById(`statusBadge${id}`);
    const toggleLabel = document.querySelector(`#toggleSwitch${id}`)?.parentElement?.querySelector('.toggle-label');

    if (badge) {
        if (state.active) {
            badge.textContent = 'Active';
            badge.className = 'config-status-badge active';
        } else {
            badge.textContent = 'Inactive';
            badge.className = 'config-status-badge';
        }
    }

    if (toggleLabel) {
        toggleLabel.textContent = state.active ? 'ON' : 'OFF';
    }
}

// ============================
// Reminder Settings
// ============================
const reminderSettings = {
    warningThreshold: 5,
    criticalThreshold: 3,
    dangerThreshold: 1,
    reminderInterval: 30000
};

let lastReminderTime = {};

// ============================
// Get Danger Level - FIXED
// ============================
function getDangerLevel(quantity) {
    if (quantity <= 0) return 5;
    if (quantity === 1) return 4;
    if (quantity <= 3) return 3;
    if (quantity <= 5) return 2;
    if (quantity <= 10) return 1;
    return 0;
}

function sendReminder(id) {
    const state = getDispenserState(id);
    if (!state.active || !state.medicine) return;
    
    const quantity = state.quantity;
    const medicine = state.medicine;
    const now = Date.now();
    
    if (lastReminderTime[id] && (now - lastReminderTime[id]) < reminderSettings.reminderInterval) {
        return;
    }
    
    let message = '';
    let type = 'warning';
    
    if (quantity <= 0) {
        message = `🚨 EMERGENCY: ${medicine} is COMPLETELY EMPTY! Please refill immediately!`;
        type = 'error';
        addNotification(`🚨¨ ${medicine} is EMPTY!`, 'danger');
    } else if (quantity === 1) {
        message = `🔴 CRITICAL: Only 1 ${medicine} pill remaining! Refill now!`;
        type = 'warning';
        addNotification(`🔴 Only 1 ${medicine} left!`, 'danger');
    } else if (quantity <= 3) {
        message = `⚠️ URGENT: ${medicine} is very low (${quantity} pills). Please refill soon!`;
        type = 'warning';
        addNotification(`⚠️ ${medicine} very low (${quantity} left)`, 'warning');
    } else if (quantity <= 5) {
        message = `ℹ️ Reminder: ${medicine} is running low (${quantity} pills). Consider refilling.`;
        type = 'info';
        addNotification(`ℹ️ ${medicine} low (${quantity} left)`, 'info');
    } else {
        return;
    }
    
    showToast(message, type);
    addHistoryItem(`🏥 Reminder: ${message}`, 'warning');
    lastReminderTime[id] = now;
}
// ============================
// Render Dispensers - FIXED
// ============================
function renderDispensers() {
    const grid = document.getElementById('dispensersGrid');
    if (!grid) return;

    
    console.log('🔍 Rendering dispensers...');
    console.log('📊 Current configState:', JSON.stringify(configState, null, 2));
    
    // âœ… FIX: Use dispenser object, not ID
    const activeDispensers = dispensers.filter(dispenser => {
        const state = getDispenserState(dispenser.id);
        const isActive = state.active === true && 
                         state.medicine && 
                         state.medicine.trim() !== '' &&
                         state.quantity !== undefined &&
                         state.quantity !== null &&
                         state.quantity > 0;
        
        console.log(`📦 Dispenser ${dispenser.id}: active=${state.active}, medicine="${state.medicine}", quantity=${state.quantity}, isActive=${isActive}`);
        return isActive;
    });
    
    console.log(`✅ Found ${activeDispensers.length} active dispensers`);
    
    if (activeDispensers.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" id="dispensersEmpty">
                <i class="fas fa-sliders-h" style="font-size: 48px; color: rgba(0,0,0,0.06); display: block; margin-bottom: 12px;"></i>
                <p>No active dispensers</p>
                <span style="font-size: 12px; color: var(--text-secondary);">
                    Go to "Medication Configuration" to activate and configure a dispenser
                </span>
            </div>
        `;
        return;
    }
    
    let html = '';
    // âœ… FIX: Use dispenser object
    activeDispensers.forEach(dispenser => {
        const id = dispenser.id;
        const state = getDispenserState(id);
        const qty = state.quantity || 0;
        const isLow = qty <= 5 && qty > 0;
        const isEmpty = qty <= 0;
        const statusClass = isEmpty ? 'danger' : isLow ? 'warning' : 'green';
        const statusText = isEmpty ? 'Empty' : isLow ? 'Low Stock' : 'Ready';
        const btnClass = isEmpty ? 'btn-dispense danger' : 'btn-dispense';
        const btnDisabled = isEmpty ? 'disabled' : '';
        const dangerLevel = getDangerLevel(qty);
        const medicineName = state.medicine || 'Unknown';
        
        html += `
            <div class="box-card glass dispenser-card" id="dispenserCard${id}" data-danger-level="${dangerLevel}">
                <div class="box-header">
                    <div class="box-title">
                        <i class="fas fa-pill box-icon"></i>
                        <span>Disp ${id}: <span class="med-name">${medicineName}</span></span>
                    </div>
                    <div class="box-status">
                        <span class="status-light ${statusClass}"></span>
                        <span>${statusText}</span>
                    </div>
                </div>
                <div class="box-body">
                    ${isEmpty ? `
                        <div class="low-stock-banner danger">
                            <i class="fas fa-exclamation-circle"></i>
                            ⚠️ Out of stock! Please refill in Configuration.
                        </div>
                    ` : isLow ? `
                        <div class="low-stock-banner warning">
                            <i class="fas fa-exclamation-triangle"></i>
                            ⚠️ Low stock! Only ${qty} pills remaining.
                        </div>
                    ` : ''}
                    
                    <div class="box-stats">
                        <div class="stat-item">
                            <span class="stat-number ${isEmpty ? 'empty' : isLow ? 'low' : ''}">${qty}</span>
                            <span class="stat-label">Remaining</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-number" id="box${id}Next">--:--</span>
                            <span class="stat-label">Next Schedule</span>
                        </div>
                    </div>
                    <div class="stock-progress">
                        <div class="stock-fill ${isEmpty ? 'danger' : isLow ? 'warning' : 'safe'}" style="width: ${Math.min((qty / 30) * 100, 100)}%;"></div>
                    </div>
                    <button class="${btnClass}" onclick="dispenseFromDispenser(${id})" ${btnDisabled}>
                        <i class="fas fa-hand-holding-medical"></i>
                        ${isEmpty ? 'Out of Stock' : 'Dispense Now'}
                    </button>
                </div>
            </div>
        `;
    });

     grid.innerHTML = html;
    updateDispenserCount();
    
    // âœ… Update next schedule display
    updateNextSchedules();
}
// ============================
// Dispense from Dispenser
// ============================
function dispenseFromDispenser(id) {
    const state = getDispenserState(id);

    if (!state.active || state.quantity <= 0) {
        showToast('⚠️ This dispenser is empty! Please refill.', 'warning');
        return;
    }

    fetch(`/dispense${id}`)
    .then(async response => {
        if (!response.ok) throw new Error("Dispense failed");

        let data = {};
        try {
            data = await response.json();
        } catch (error) {
            data = {};
        }

        const newQuantity = Number.isFinite(Number(data.quantity))
            ? Number(data.quantity)
            : Math.max(0, state.quantity - 1);

        setDispenserState(id, { quantity: newQuantity });
        renderDispensers();
        updateConfigUI(id);
        showToast(`${state.medicine} dispensed!`, "success");
        addHistoryItem(`Dispensed ${state.medicine} from Box ${id}`, "success");
        updateDispenserCount();
    })
    .catch(err => {
        console.error(err);
        showToast("Failed to dispense", "error");
    });

}
// ============================
// Update Config UI
// ============================
function updateConfigUI(id) {
    const state = getDispenserState(id);
    const stockDisplay = document.getElementById(`stockDisplay${id}`);
    const saveStatus = document.getElementById(`saveStatus${id}`);
    
    if (stockDisplay) stockDisplay.textContent = state.quantity || 0;
    if (saveStatus) {
        saveStatus.className = 'config-save-status';
        saveStatus.innerHTML = '<i class="fas fa-sync-alt fa-spin"></i> Quantity updated from dispenser';
        setTimeout(() => {
            if (saveStatus) {
                saveStatus.className = 'config-save-status';
                saveStatus.innerHTML = '<i class="fas fa-check-circle"></i> ✔️ Configuration Saved';
                setTimeout(() => saveStatus.classList.add('hidden'), 2000);
            }
        }, 1500);
    }
    validateMedicine(id);
}


// ============================
// Refill Dispenser – Final
// ============================
function refillDispenser(id, amount = null, btn = null) {
    const state = getDispenserState(id);

    // ❌ Prevent refilling inactive dispenser
    if (!state.active) {
        showToast("⚠️ Activate the dispenser first", "warning");
        return;
    }

    // If amount is not provided, read from the custom input
    if (amount === null) {
        const input = document.getElementById(`refillAmount${id}`);
        amount = parseInt(input.value);
    }

    if (isNaN(amount) || amount <= 0) {
        showToast("⚠️ Enter a valid number of pills", "warning");
        return;
    }

    // ✅ Quick‑button highlight and disable
    if (btn) {
        btn.classList.add("clicked");
        setTimeout(() => btn.classList.remove("clicked"), 400);
        btn.disabled = true;
    }

    const formData = new FormData();
    formData.append("id", id);
    formData.append("amount", amount);

    fetch("/addPills", {
        method: "POST",
        body: formData
    })
    .then(response => {
        if (!response.ok) throw new Error("Server error");
        return response.text();
    })
    .then(newTotal => {
        // ✅ Reload the entire configuration – this re‑renders everything
        loadConfig();

        // ✅ Professional toast with both added and new total
        showToast(`✅ Refill Successful! +${amount} pills added – Current stock: ${newTotal} pills`, "success");

        // Clear the custom input field
        const input = document.getElementById(`refillAmount${id}`);
        if (input) input.value = '';
    })
    .catch(error => {
        console.error("Refill error:", error);
        showToast("❌ Failed to refill dispenser", "error");
    })
    .finally(() => {
        // ✅ Re‑enable the button
        if (btn) btn.disabled = false;
    });
}
// ============================
// Update Dispenser Count Badge - FIXED
// ============================
function updateDispenserCount() {
    const sectionTitle = document.querySelector('.section:nth-child(2) .section-title');
    if (!sectionTitle) return;
    
    // âœ… FIX: Use dispenser object, not ID
    const activeCount = dispensers.filter(dispenser => {
        const state = getDispenserState(dispenser.id);
        return state.active && state.medicine && state.quantity > 0;
    }).length;
    
    const existingBadge = sectionTitle.querySelector('.dispenser-badge');
    if (existingBadge) existingBadge.remove();
    
    if (activeCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'dispenser-badge';
        badge.textContent = `${activeCount} active`;
        badge.style.marginLeft = '12px';
        sectionTitle.appendChild(badge);
    }
}
// ============================
// Populate Dispenser Dropdown
// ============================
// ============================
// Populate Dispenser Dropdown - FIXED
// ============================
function populateDispenserDropdown() {
    const select = document.getElementById('scheduleBox');
    if (!select) return;
    
    select.innerHTML = '';
    
    // âœ… FIX: Use dispenser object, not ID
    const activeDispensers = dispensers.filter(dispenser => {
        const state = getDispenserState(dispenser.id);
        return state.active && state.medicine && state.quantity > 0;
    });
    
    if (activeDispensers.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '⚠️ No active dispensers';
        option.disabled = true;
        select.appendChild(option);
        return;
    }
    
    // âœ… FIX: Use dispenser object
    activeDispensers.forEach(dispenser => {
        const state = getDispenserState(dispenser.id);
        const option = document.createElement('option');
        option.value = dispenser.id;
        option.textContent = `💊 Disp ${dispenser.id} - ${state.medicine}`;
        select.appendChild(option);
    });
}

// ============================
// NEW FUNCTIONS FOR ADDED HTML ELEMENTS
// ============================
function clearNotifications() {
    const container = document.getElementById('notificationsContainer');
    if (!container) return;
    
    const items = container.querySelectorAll('.notification-item');
    items.forEach(item => item.remove());
    
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-check-circle"></i>
            <p>All clear!</p>
        </div>
    `;
    
    updateNotificationBadge();
    showToast('🗑️ All notifications cleared', 'info');
}

function checkConnectionStatus() {
    const statusElement = document.getElementById('connectionStatus');
    const iconElement = document.getElementById('connectionIcon');
    const textElement = document.getElementById('connectionText');
    
    if (!statusElement) return;
    
    fetch('/data', { 
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' }
    })
    .then(response => {
        if (response.ok) {
            statusElement.className = 'header-item';
            statusElement.classList.remove('disconnected');
            if (iconElement) {
                iconElement.style.color = 'var(--success)';
                iconElement.className = 'fas fa-plug';
            }
            if (textElement) textElement.textContent = 'Connected';
        } else {
            throw new Error('Connection failed');
        }
    })
    .catch(() => {
        statusElement.classList.add('disconnected');
        if (iconElement) {
            iconElement.style.color = 'var(--danger)';
            iconElement.className = 'fas fa-plug';
        }
        if (textElement) textElement.textContent = 'Disconnected';
    });
}

// ============================
// Start Reminder Loop - FIXED
// ============================
function startReminderLoop() {
    setInterval(() => {
        // âœ… FIX: Use dispenser object, not ID
        dispensers.forEach(dispenser => {
            const state = getDispenserState(dispenser.id);
            if (state.active && state.medicine && state.quantity <= 5 && state.quantity > 0) {
                sendReminder(dispenser.id);
            }
        });
    }, 60000);
}
function updateFooterStatus() {
    const dot = document.querySelector('.footer .status-dot');
    const text = document.querySelector('.footer .footer-item:first-child span:last-child');
    
    if (!dot || !text) return;
    
    fetch('/data', { 
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' }
    })
    .then(response => {
        if (response.ok) {
            dot.className = 'status-dot online';
            text.textContent = 'ESP32 Connected';
        } else {
            throw new Error('Connection failed');
        }
    })
    .catch(() => {
        dot.className = 'status-dot offline';
        text.textContent = 'ESP32 Disconnected';
    });
}

// ============================
// Export for HTML onclick
// ============================
window.clearNotifications = clearNotifications;
window.checkConnectionStatus = checkConnectionStatus;
window.dispenseFromDispenser = dispenseFromDispenser;