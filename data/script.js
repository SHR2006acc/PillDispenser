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
    
    const dateInput = document.getElementById('scheduleDate');
    const hourInput = document.getElementById('scheduleHour');
    const minuteInput = document.getElementById('scheduleMinute');
    
    if (dateInput) {
        dateInput.addEventListener('change', validateDateTime);
        dateInput.addEventListener('input', validateDateTime);
    }
    if (hourInput) {
        hourInput.addEventListener('change', validateDateTime);
        hourInput.addEventListener('input', validateDateTime);
    }
    if (minuteInput) {
        minuteInput.addEventListener('change', validateDateTime);
        minuteInput.addEventListener('input', validateDateTime);
    }
    
    updateTimeHelper();
    setInterval(updateTimeHelper, 60000);
    
    setTimeout(validateDateTime, 500);
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
                const qtyInput = document.getElementById(`medQuantity${id}`);
                if (nameInput && document.activeElement !== nameInput) {
                    nameInput.value = configState[id].medicine;
                    nameInput.disabled = !configState[id].active;
                }
                if (qtyInput && document.activeElement !== qtyInput) {
                    qtyInput.value = configState[id].quantity || '';
                    qtyInput.disabled = !configState[id].active;
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
        .catch(error => {
            console.error('Error fetching sensor data:', error);
            showToast('Failed to fetch sensor data', 'error');
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

// ============================
// Schedule Functions
// ============================
function addSchedule() {
    const dateInput = document.getElementById('scheduleDate');
    const hourInput = document.getElementById('scheduleHour');
    const minuteInput = document.getElementById('scheduleMinute');
    const boxSelect = document.getElementById('scheduleBox');
    
    if (!dateInput || !hourInput || !minuteInput || !boxSelect) return;
    
    const dateParts = dateInput.value.split('-');
    if (dateParts.length !== 3) {
        showToast('⚠️ Please select a valid date', 'error');
        return;
    }
    
    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]);
    const day = parseInt(dateParts[2]);
    const hour = parseInt(hourInput.value);
    const minute = parseInt(minuteInput.value);
    const box = parseInt(boxSelect.value);
    
    if (isNaN(year) || isNaN(month) || isNaN(day) || isNaN(hour) || isNaN(minute) || isNaN(box) ||
        year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31 ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59 || box < 1 || box > 2) {
        showToast('⚠️ Invalid input!', 'error');
        return;
    }
    
    const state = getDispenserState(box);
    if (!state.active || !state.medicine || state.quantity <= 0) {
        showToast('⚠️ Selected dispenser is inactive or out of stock!', 'warning');
        return;
    }
    
    const now = new Date();
    const selectedDate = new Date(year, month - 1, day, hour, minute);
    
    if (selectedDate < now) {
        showToast('⏰ Cannot schedule in the past! Please select a future date and time.', 'warning');
        dateInput.style.borderColor = 'var(--danger)';
        dateInput.style.background = 'rgba(239, 68, 68, 0.05)';
        setTimeout(() => {
            dateInput.style.borderColor = '';
            dateInput.style.background = '';
        }, 2000);
        return;
    }
    
    const duplicate = currentSchedules.some(s => 
        s.year === year && s.month === month && s.day === day &&
        s.hour === hour && s.minute === minute && s.box === box
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

    saveSchedule(index, year, month, day, hour, minute, box);
}

function getNextScheduleSlot() {
    const usedSlots = new Set(currentSchedules.map(schedule => Number(schedule.id)));
    for (let i = 0; i < MAX_SCHEDULES; i++) {
        if (!usedSlots.has(i)) return i;
    }
    return -1;
}

function saveSchedule(index, year, month, day, hour, minute, box) {
    let formData = new FormData();
    formData.append("index", index);
    formData.append("year", year);
    formData.append("month", month);
    formData.append("day", day);
    formData.append("hour", hour);
    formData.append("min", minute);
    formData.append("box", box);

    fetch('/updateSchedule', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (response.ok) {
            currentSchedules.push({ 
                id: index,
                year, month, day,
                hour, minute, 
                box, 
                active: true 
            });
            renderScheduleList();
           // âœ… Update next schedule display
            updateNextSchedules();
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            showToast(`✅ Schedule added: ${dateStr} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} - Box ${box}`, 'success');
            addNotification(`📅 New schedule added: ${dateStr} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} - Box ${box}`, 'info');
        } else {
            throw new Error('Failed to save schedule');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        showToast('❌ Failed to save schedule', 'error');
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
                    active: true
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
}
function renderScheduleList() {
    const list = document.getElementById('scheduleList');
    if (!list) return;
    
    if (currentSchedules.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span>📅</span>
                <p>No schedules set yet</p>
                <span style="font-size: 12px; color: var(--text-secondary);">
                    Pick a date, time, box, and click "Add Schedule"
                </span>
            </div>
        `;
        return;
    }
    
    const sorted = [...currentSchedules].sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        if (a.month !== b.month) return a.month - b.month;
        if (a.day !== b.day) return a.day - b.day;
        if (a.hour !== b.hour) return a.hour - b.hour;
        return a.minute - b.minute;
    });
    
    list.innerHTML = sorted.map((schedule, index) => {
        const actualIndex = Number.isFinite(Number(schedule.id)) ? Number(schedule.id) : currentSchedules.indexOf(schedule);
        const dateStr = `${schedule.year}-${String(schedule.month).padStart(2, '0')}-${String(schedule.day).padStart(2, '0')}`;
        const timeStr = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`;
        
        const state = getDispenserState(schedule.box);
        const medicineName = state.medicine || `Box ${schedule.box}`;
        const boxClass = schedule.box === 1 ? 'box1' : 'box2';
        
        return `
            <div class="schedule-item">
                <span class="time">${dateStr} ${timeStr}</span>
                <span class="box-label ${boxClass}">${medicineName}</span>
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

function validateDateTime() {
    const dateInput = document.getElementById('scheduleDate');
    const hourInput = document.getElementById('scheduleHour');
    const minuteInput = document.getElementById('scheduleMinute');
    const dateHelper = document.getElementById('dateHelper');
    const timeHelper = document.getElementById('timeHelper');
    const dateBadge = document.getElementById('dateHelperBadge');
    const timeBadge = document.getElementById('timeHelperBadge');

    if (!dateInput || !hourInput || !minuteInput) return;

    const dateParts = dateInput.value.split('-');
    if (dateParts.length !== 3) return;

    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]);
    const day = parseInt(dateParts[2]);
    const hour = parseInt(hourInput.value) || 0;
    const minute = parseInt(minuteInput.value) || 0;

    if (isNaN(year) || isNaN(month) || isNaN(day)) return;

    const now = new Date();
    const selectedDate = new Date(year, month - 1, day, hour, minute);

    // ===== Date Validation =====
    if (dateHelper) {
        const today = new Date();
        const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const selectedDateOnly = new Date(year, month - 1, day);

        if (selectedDateOnly < todayDate) {
            dateHelper.className = 'date-helper warning';
            dateHelper.innerHTML =
                '<i class="fas fa-exclamation-circle"></i> ⚠️ This date is in the past! Please select today or a future date.';

            if (dateBadge) {
                dateBadge.className = 'helper-badge warning';
                dateBadge.innerHTML =
                    '<i class="fas fa-exclamation-triangle"></i> Invalid date';
            }

        } else if (selectedDateOnly.getTime() === todayDate.getTime()) {

            dateHelper.className = 'date-helper success';
            dateHelper.innerHTML =
                '<i class="fas fa-check-circle"></i> ✅ Today is OK! Just make sure the time is in the future.';

            if (dateBadge) {
                dateBadge.className = 'helper-badge';
                dateBadge.innerHTML =
                    '<i class="fas fa-check-circle"></i> Today';
            }

        } else {

            dateHelper.className = 'date-helper success';
            dateHelper.innerHTML =
                '<i class="fas fa-check-circle"></i> ✅ Future date selected.';

            if (dateBadge) {
                dateBadge.className = 'helper-badge';
                dateBadge.innerHTML =
                    '<i class="fas fa-check-circle"></i> Future date';
            }
        }
    }

    // ===== Time Validation =====
    if (timeHelper) {

        if (selectedDate < now) {

            timeHelper.className = 'time-helper warning';
            timeHelper.innerHTML =
                '<i class="fas fa-exclamation-circle"></i> ⚠️ This time has already passed! Please select a future time.';

            if (timeBadge) {
                timeBadge.className = 'helper-badge warning';
                timeBadge.innerHTML =
                    '<i class="fas fa-exclamation-triangle"></i> Invalid time';
            }

        } else {

            timeHelper.className = 'time-helper success';
            timeHelper.innerHTML =
                '<i class="fas fa-check-circle"></i> ✅ Valid future time.';

            if (timeBadge) {
                timeBadge.className = 'helper-badge';
                timeBadge.innerHTML =
                    '<i class="fas fa-check-circle"></i> Valid time';
            }
        }
    }
}

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


// ============================
// Render Configuration UI
// ============================
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

                    <div class="config-form-group">
                        <label for="medQuantity${d.id}">Quantity</label>
                        <input type="number" id="medQuantity${d.id}" placeholder="Number of pills" min="1" value="${state.quantity || ''}" ${!state.active ? 'disabled' : ''}>
                        <div class="config-validation hidden" id="qtyValidation${d.id}"></div>
                    </div>

                    <div class="config-actions">
                        <button class="btn-config-save" id="saveBtn${d.id}" ${!state.active ? 'disabled' : ''}>
                            <i class="fas fa-save"></i> Save Configuration
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
        const qtyInput = document.getElementById(`medQuantity${d.id}`);

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

        if (qtyInput) {
            qtyInput.addEventListener('input', function() {
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
    const qtyInput = document.getElementById(`medQuantity${id}`);
    const saveStatus = document.getElementById(`saveStatus${id}`);
    const nameValidation = document.getElementById(`nameValidation${id}`);
    const qtyValidation = document.getElementById(`qtyValidation${id}`);

    if (card) card.classList.toggle('active', newActive);
    if (toggleSwitch) toggleSwitch.classList.toggle('active', newActive);
    if (toggleInput) toggleInput.checked = newActive;
    if (saveBtn) saveBtn.disabled = !newActive;
    
    if (nameInput) {
        nameInput.disabled = !newActive;
        if (!newActive) nameInput.classList.remove('error', 'success');
    }
    if (qtyInput) {
        qtyInput.disabled = !newActive;
        if (!newActive) qtyInput.classList.remove('error', 'success');
    }
    if (saveStatus) saveStatus.classList.add('hidden');
    if (nameValidation) {
        nameValidation.classList.add('hidden');
        nameValidation.textContent = '';
    }
    if (qtyValidation) {
        qtyValidation.classList.add('hidden');
        qtyValidation.textContent = '';
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
    const qtyInput = document.getElementById(`medQuantity${id}`);
    const nameValidation = document.getElementById(`nameValidation${id}`);
    const qtyValidation = document.getElementById(`qtyValidation${id}`);
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

    if (qtyInput && qtyValidation) {
        const qty = parseInt(qtyInput.value);
        if (isNaN(qty) || qty < 1) {
            qtyValidation.textContent = '⚠️  Quantity must be at least 1';
            qtyValidation.className = 'config-validation';
            qtyInput.classList.add('error');
            qtyInput.classList.remove('success');
            isValid = false;
        } else {
            qtyValidation.textContent = '✅ Valid';
            qtyValidation.className = 'config-validation success';
            qtyInput.classList.remove('error');
            qtyInput.classList.add('success');
        }
    }

    if (saveBtn) {
        saveBtn.disabled = !isValid || !state.active;
    }

    return isValid;
}

function clearValidation(id) {
    const nameValidation = document.getElementById(`nameValidation${id}`);
    const qtyValidation = document.getElementById(`qtyValidation${id}`);
    const nameInput = document.getElementById(`medName${id}`);
    const qtyInput = document.getElementById(`medQuantity${id}`);

    if (nameValidation) {
        nameValidation.textContent = '';
        nameValidation.className = 'config-validation hidden';
    }
    if (qtyValidation) {
        qtyValidation.textContent = '';
        qtyValidation.className = 'config-validation hidden';
    }
    if (nameInput) {
        nameInput.classList.remove('error', 'success');
    }
    if (qtyInput) {
        qtyInput.classList.remove('error', 'success');
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
    const qtyInput = document.getElementById(`medQuantity${id}`);
    const saveBtn = document.getElementById(`saveBtn${id}`);
    const saveStatus = document.getElementById(`saveStatus${id}`);

    const medicine = nameInput ? nameInput.value.trim() : '';
    const quantity = qtyInput ? parseInt(qtyInput.value) : 0;

    setDispenserState(id, { 
        medicine, 
        quantity, 
        active: true,
        saved: true 
    });

    if (saveStatus) {
        saveStatus.className = 'config-save-status';
        saveStatus.innerHTML = '<i class="fas fa-check-circle"></i> ✔️ Configuration Saved';
    }

    if (saveBtn) {
        saveBtn.classList.add('saved');
        setTimeout(() => saveBtn.classList.remove('saved'), 600);
    }

    let saveFormData = new FormData();
saveFormData.append('id', id);
saveFormData.append('medicine', medicine);
saveFormData.append('quantity', quantity);

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
    const qtyInput = document.getElementById(`medQuantity${id}`);
    const saveStatus = document.getElementById(`saveStatus${id}`);
    
    if (qtyInput) qtyInput.value = state.quantity;
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
