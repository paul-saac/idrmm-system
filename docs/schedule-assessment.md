# Visible project schedule assessment

The workspace header shows the official Project schedule, Delay risk and Forecast
completion. Select either assessment value to read its explanation. The approved
dates, Gantt bars, actual progress and project status are not changed by a forecast.

## Data and calculation

`lib/projects/schedule-assessment.ts` uses saved task/category progress and dated
progress records. A category with subtasks is a summary; its own progress is not
counted again. Expected progress based on elapsed dates is only a comparison.

For an incomplete task with recorded completion greater than zero:

1. Count working days from its planned start (or an earlier first log) through its
   latest saved log. The minimum elapsed period is one working day.
2. Average pace = recorded completion percentage / elapsed working days.
3. Remaining working days = ceiling((100 - recorded completion) / average pace).

An unstarted task retains its planned working-day duration. Remaining work starts
no earlier than today, its planned start and its predecessor's projected finish.
When today's log has already been recorded, remaining work starts on the next
working day. Finish-to-start links, project working weekdays and holidays apply.
Parallel tasks keep their own constraints; a summary's successor waits for all its
subtasks. A milestone is a zero-duration point. The latest projected task finish
is the project forecast; its difference from the official target is in calendar days.

## Risk rules

| Display | Rule |
| --- | --- |
| High | Projected finish exceeds the official target. |
| Medium | The projection fits the target, but at least one incomplete task is behind expected progress by more than five percentage points. |
| Low | The projection fits the target and no incomplete task exceeds that lag tolerance. |
| Completed | Every task has 100% saved completion and dated records. Shows the recorded actual end, or latest saved record if no actual end exists. |
| Not assessed | There is insufficient or invalid evidence to calculate reliably. |

No logs, missing dates or dependency references, dependency cycles, future-dated
logs, progress without dated records, or records over two working days old prevent
assessment. Nonmilestone tasks must have a working day in their date range.
Projections exceeding ten years are withheld rather than shown as precise dates.

## Interpretation and limitations

This is a deterministic remaining-work projection and a rule-based schedule
warning, not a statistical probability or an AI prediction. It assumes the recorded
average pace continues; unstarted work uses planned pace. Actual progress follows
the application's existing saved progress calculation, including its quantity,
cost and material fallbacks. Results depend on accurate, current logs and links.

A delayed task can consume available schedule allowance without moving the
official deadline. Linked delays can propagate into the forecast. Management
reviews the warning and decides whether the official plan needs revision.

The separation of baseline dates and current projections, and the use of schedule
logic, are informed by the [GAO Schedule Assessment Guide](https://www.gao.gov/products/gao-16-89g).
The specific formula, thresholds and freshness rules above are application rules;
they are not GAO certification or a full probabilistic schedule risk analysis.
