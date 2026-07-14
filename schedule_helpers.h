#ifndef SCHEDULE_HELPERS_H
#define SCHEDULE_HELPERS_H

#include <stdint.h>

// Makuna RTC returns: 1=Sunday, 2=Monday, ... 7=Saturday.
// Internal representation: 0=Sunday, 1=Monday, ... 6=Saturday.
// VERIFY: Print now.DayOfWeek() on a known day to confirm your library's output.
// If your library returns 0 for Sunday, set this to 0.
static constexpr uint8_t RTC_DOW_OFFSET = 1;

// Convert RTC day-of-week to internal 0-6 representation.
static inline uint8_t scheduleWeekdayFromRtc(uint8_t rtcDayOfWeek)
{
    return (rtcDayOfWeek - RTC_DOW_OFFSET + 7) % 7;
}

#endif