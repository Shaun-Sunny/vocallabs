'use client';

interface QuotaIndicatorProps {
  used: number;
  limit: number;
  runsThisMonth?: number;
  avgDuration?: number;
}

export function QuotaIndicator({ used, limit, runsThisMonth, avgDuration }: QuotaIndicatorProps) {
  const percent = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const isNearLimit = percent >= 80;
  const isExhausted = used >= limit;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">Usage Quota</h3>
        <span className={`text-sm font-semibold ${isExhausted ? 'text-red-600' : isNearLimit ? 'text-amber-600' : 'text-gray-900'}`}>
          {used} / {limit}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${
            isExhausted ? 'bg-red-500' : isNearLimit ? 'bg-amber-500' : 'bg-brand-500'
          }`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">{percent}% used this period</p>
      {(runsThisMonth !== undefined || avgDuration !== undefined) && (
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs text-gray-500">
          {runsThisMonth !== undefined && (
            <div>
              <span className="font-medium text-gray-700">{runsThisMonth}</span> runs this month
            </div>
          )}
          {avgDuration !== undefined && avgDuration > 0 && (
            <div>
              Avg duration: <span className="font-medium text-gray-700">{avgDuration.toFixed(1)}s</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
