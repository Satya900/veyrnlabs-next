"use client";
import { useState } from "react";
import { calendarItems, groupByDate, localDateKey } from "@/lib/crm/workspace";
import { useWorkspaceContext } from "./context";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Calendar() {
  const { data, stages, setSelected } = useWorkspaceContext();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const grouped = groupByDate(calendarItems(data, stages));
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = localDateKey(new Date());
  const cells: (Date | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <section className="crm-panel">
      <div className="crm-panel-heading">
        <div>
          <h2>{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
          <p>Open follow-ups and incomplete tasks, by day.</p>
        </div>
        <div className="crm-calendar-nav">
          <button aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}>
            ←
          </button>
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(1);
              setCursor(d);
            }}
          >
            Today
          </button>
          <button aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}>
            →
          </button>
        </div>
      </div>
      <div className="crm-calendar-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="crm-calendar-weekday">
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="crm-calendar-cell is-empty" />;
          const key = localDateKey(date);
          const dayItems = grouped[key] ?? [];
          return (
            <div key={i} className={`crm-calendar-cell${key === todayKey ? " is-today" : ""}`}>
              <span className="crm-calendar-date">{date.getDate()}</span>
              {dayItems.slice(0, 3).map((item) => (
                <button
                  key={item.id}
                  className={`crm-calendar-item ${item.kind}`}
                  onClick={() => setSelected(item.leadId)}
                >
                  {item.title}
                </button>
              ))}
              {dayItems.length > 3 && (
                <span className="crm-calendar-more">+{dayItems.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
