import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activityLog';
import { UserProfile, Shift, Priority } from '../types';
import { Loader2, Calendar, Trash2, Plus, Star, Map, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, isBefore, startOfDay, parseISO } from 'date-fns';
import { getRandomGreeting } from '../utils/greetings'; // Импорт функции приветствия

// Доступные месяцы для выбора
const AVAILABLE_MONTHS = [
  { value: 3, label: 'Апрель', year: 2025 },
  { value: 4, label: 'Май', year: 2025 },
  { value: 5, label: 'Июнь', year: 2025 },
  { value: 6, label: 'Июль', year: 2025 },
  { value: 7, label: 'Август', year: 2025 },
  { value: 8, label: 'Сентябрь', year: 2025 },
];

// Получить год для месяца (месяц 0-indexed)
function getYearForMonth(monthIndex: number): number {
  const m = AVAILABLE_MONTHS.find(m => m.value === monthIndex);
  return m?.year ?? new Date().getFullYear();
}

// Минимальная дата для выбранного месяца
function getMonthMinDate(monthIndex: number): string {
  const year = getYearForMonth(monthIndex);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
}

// Максимальная дата для выбранного месяца
function getMonthMaxDate(monthIndex: number): string {
  const year = getYearForMonth(monthIndex);
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// Проверка: можно ли удалить смену
function canDeleteShift(shift: Shift): { allowed: boolean; reason?: string } {
  const now = new Date();
  const today = startOfDay(now);
  const shiftDate = parseISO(shift.work_date);
  const shiftDay = startOfDay(shiftDate);

  // Нельзя удалить прошедшие и текущий день
  if (isBefore(shiftDay, today) || shiftDay.getTime() === today.getTime()) {
    return { allowed: false, reason: 'Нельзя удалить прошедшую смену' };
  }

  // Проверяем: если смена завтра, то до начала должно быть > 22ч
  // Начало смены — если полный день, то 00:00, если нет — start_time
  const startTimeStr = shift.is_full_day ? '00:00:00' : (shift.start_time || '00:00:00');
  const shiftStart = new Date(`${shift.work_date}T${startTimeStr}`);
  const diffHours = (shiftStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (diffHours < 22) {
    return { allowed: false, reason: 'До начала смены менее 22 часов — удаление невозможно' };
  }

  return { allowed: true };
}

interface EmployeeDashboardProps {
  profile: UserProfile;
}

export function EmployeeDashboard({ profile }: EmployeeDashboardProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [greeting, setGreeting] = useState(''); // Состояние для приветствия

  // Выбранный месяц (0-indexed, из AVAILABLE_MONTHS)
  const [selectedMonthIndex, setSelectedMonthIndex] = useState<number>(() => {
    const currentMonth = new Date().getMonth(); // 0-indexed
    const found = AVAILABLE_MONTHS.find(m => m.value === currentMonth);
    return found ? found.value : AVAILABLE_MONTHS[0].value;
  });

  // Форма добавления смены
  const [workDate, setWorkDate] = useState('');
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [savingShift, setSavingShift] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Живые часы
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Генерация приветствия при загрузке или изменении ФИО
  useEffect(() => {
    if (profile.full_name) {
      setGreeting(getRandomGreeting(profile.full_name, new Date()));
    }
  }, [profile.full_name]);

  useEffect(() => {
    fetchData();
  }, [profile.id]);

  // Сбрасываем выбранную дату при смене месяца
  useEffect(() => {
    setWorkDate('');
    setFormError(null);
  }, [selectedMonthIndex]);

  const fetchData = async () => {
    setLoading(true);
    const { data: shiftData, error: shiftError } = await supabase
      .from('employee_availability')
      .select('id, employee_id, work_date, is_full_day, start_time, end_time')
      .eq('employee_id', profile.id)
      .order('work_date', { ascending: true });

    if (shiftData) setShifts(shiftData as Shift[]);
    if (shiftError) console.error(shiftError);

    const { data: prioData, error: prioError } = await supabase
      .from('employee_attraction_priorities')
      .select('id, priority_level, attractions(name)')
      .eq('employee_id', profile.id)
      .order('priority_level', { ascending: true });

    if (prioData) setPriorities(prioData as unknown as Priority[]);
    if (prioError) console.error(prioError);

    setLoading(false);
  };

  // Смены выбранного месяца
  const shiftsForMonth = useMemo(() => {
    return shifts.filter(s => {
      const d = parseISO(s.work_date);
      return d.getMonth() === selectedMonthIndex;
    });
  }, [shifts, selectedMonthIndex]);

  // Даты, на которые уже есть смены (весь список, для блокировки)
  const occupiedDates = useMemo(() => {
    return new Set(shifts.map(s => s.work_date));
  }, [shifts]);

  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!workDate) {
      setFormError('Выберите дату');
      return;
    }

    // Проверка: дата принадлежит выбранному месяцу
    const selectedDate = parseISO(workDate);
    if (selectedDate.getMonth() !== selectedMonthIndex) {
      setFormError('Выбранная дата не соответствует выбранному месяцу');
      return;
    }

    // Проверка: смена на эту дату уже есть
    if (occupiedDates.has(workDate)) {
      setFormError('На эту дату уже установлена смена. Удалите существующую смену, чтобы добавить новую.');
      return;
    }

    if (!isFullDay && (!startTime || !endTime)) {
      setFormError('Укажите время начала и конца смены');
      return;
    }

    if (!isFullDay && startTime >= endTime) {
      setFormError('Время начала должно быть раньше времени конца');
      return;
    }

    setSavingShift(true);

    const newShift = {
      employee_id: profile.id,
      work_date: workDate,
      is_full_day: isFullDay,
      start_time: isFullDay ? null : startTime,
      end_time: isFullDay ? null : endTime,
    };

    const { error } = await supabase.from('employee_availability').insert([newShift]);

    if (!error) {
      await logActivity(
        'employee',
        profile.id,
        'shift_add',
        `Сотрудник ${profile.full_name} добавил смену на ${workDate}${!isFullDay ? ` (${startTime}–${endTime})` : ' (полный день)'}`
      );
      setWorkDate('');
      setIsFullDay(true);
      setStartTime('');
      setEndTime('');
      await fetchData();
    } else {
      console.error(error);
      setFormError('Ошибка при добавлении смены. Попробуйте ещё раз.');
    }
    setSavingShift(false);
  };

  const handleDeleteShift = async (shift: Shift) => {
    const { allowed, reason } = canDeleteShift(shift);
    if (!allowed) {
      alert(reason);
      return;
    }

    if (!confirm('Удалить смену?')) return;

    const { error } = await supabase.from('employee_availability').delete().eq('id', shift.id);
    if (!error) {
      await logActivity(
        'employee',
        profile.id,
        'shift_delete',
        `Сотрудник ${profile.full_name} удалил смену на ${shift.work_date}`
      );
      await fetchData();
    } else {
      alert('Ошибка при удалении смены');
    }
  };

  const currentMonthLabel = AVAILABLE_MONTHS.find(m => m.value === selectedMonthIndex)?.label || '';
  const currentMonthIdx = AVAILABLE_MONTHS.findIndex(m => m.value === selectedMonthIndex);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-16">
        <Loader2 className="animate-spin text-blue-600 h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Шапка профиля с приветствием */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">
            {greeting || profile.full_name}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {profile.full_name} • Возраст: {profile.age ?? 'Не указан'}
          </p>
        </div>
        <div className="mt-4 md:mt-0 text-right">
          <div className="text-2xl font-mono text-blue-600 font-semibold">
            {now.toLocaleTimeString('ru-RU')}
          </div>
          <div className="text-gray-500 text-sm mt-1">
            {now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Выбор месяца */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => currentMonthIdx > 0 && setSelectedMonthIndex(AVAILABLE_MONTHS[currentMonthIdx - 1].value)}
            disabled={currentMonthIdx === 0}
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronLeft className="h-5 w-5 text-gray-600" />
          </button>
          <h3 className="text-base font-semibold text-gray-700">
            Выбор месяца
          </h3>
          <button
            onClick={() => currentMonthIdx < AVAILABLE_MONTHS.length - 1 && setSelectedMonthIndex(AVAILABLE_MONTHS[currentMonthIdx + 1].value)}
            disabled={currentMonthIdx === AVAILABLE_MONTHS.length - 1}
            className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
          >
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {AVAILABLE_MONTHS.map((m) => (
            <button
              key={m.value}
              onClick={() => setSelectedMonthIndex(m.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedMonthIndex === m.value
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Левая: смены + форма */}
        <div className="lg:col-span-2 space-y-6">
          {/* Список смен за выбранный месяц */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <Calendar className="mr-2 h-5 w-5 text-blue-500" />
              Мои смены — {currentMonthLabel}
            </h3>

            {shiftsForMonth.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Calendar className="mx-auto h-10 w-10 mb-2 opacity-50" />
                <p>Смен в {currentMonthLabel.toLowerCase()} не найдено</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Дата</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Тип</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Время</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {shiftsForMonth.map(shift => {
                      const { allowed } = canDeleteShift(shift);
                      return (
                        <tr key={shift.id} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {format(parseISO(shift.work_date), 'dd.MM.yyyy')}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {shift.is_full_day ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                Полный день
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                Неполный день
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {shift.is_full_day
                              ? 'Весь день'
                              : `${shift.start_time?.slice(0, 5)} – ${shift.end_time?.slice(0, 5)}`}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {allowed ? (
                              <button
                                onClick={() => handleDeleteShift(shift)}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition"
                                title="Удалить смену"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400 italic">Удаление недоступно</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Форма добавления смены */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <Plus className="mr-2 h-5 w-5 text-blue-500" />
              Добавить смену — {currentMonthLabel}
            </h3>

            <form onSubmit={handleAddShift} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Дата смены <span className="text-gray-400 text-xs">(только {currentMonthLabel})</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={workDate}
                    min={getMonthMinDate(selectedMonthIndex)}
                    max={getMonthMaxDate(selectedMonthIndex)}
                    onChange={(e) => {
                      setWorkDate(e.target.value);
                      setFormError(null);
                      // Проверим, занята ли уже эта дата
                      if (e.target.value && occupiedDates.has(e.target.value)) {
                        setFormError('На эту дату уже установлена смена.');
                      }
                    }}
                    className={`block w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition ${
                      workDate && occupiedDates.has(workDate)
                        ? 'border-red-300 bg-red-50'
                        : 'border-gray-300'
                    }`}
                  />
                  {workDate && occupiedDates.has(workDate) && (
                    <p className="mt-1 text-xs text-red-600">На эту дату уже есть смена</p>
                  )}
                </div>

                <div className="flex items-center pt-6">
                  <label className="flex items-center cursor-pointer select-none">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={isFullDay}
                        onChange={(e) => {
                          setIsFullDay(e.target.checked);
                          if (e.target.checked) {
                            setStartTime('');
                            setEndTime('');
                          }
                        }}
                        className="sr-only"
                      />
                      <div className={`w-10 h-6 rounded-full transition ${isFullDay ? 'bg-blue-600' : 'bg-gray-300'}`}></div>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isFullDay ? 'translate-x-5' : 'translate-x-1'}`}></div>
                    </div>
                    <span className="ml-3 text-sm font-medium text-gray-700">Полный день</span>
                  </label>
                </div>
              </div>

              {!isFullDay && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Время начала</label>
                    <input
                      type="time"
                      required
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Время окончания</label>
                    <input
                      type="time"
                      required
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                    />
                  </div>
                </div>
              )}

              {formError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={savingShift || (!!workDate && occupiedDates.has(workDate))}
                className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {savingShift ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить смену
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Правая колонка: приоритеты */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
              <Star className="mr-2 h-5 w-5 text-yellow-500" />
              Приоритеты аттракционов
            </h3>
            {priorities.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <Map className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Приоритеты не заданы</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {priorities.map(prio => (
                  <li key={prio.id} className="py-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 flex items-center">
                      <Map className="mr-2 h-4 w-4 text-gray-400" />
                      {prio.attractions?.name || 'Неизвестный'}
                    </span>
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      prio.priority_level === 1 ? 'bg-green-100 text-green-800' :
                      prio.priority_level === 2 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      #{prio.priority_level}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Сводка по месяцу */}
          <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
            <h3 className="text-sm font-semibold text-blue-800 mb-3">Сводка — {currentMonthLabel}</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-blue-700">Всего смен:</span>
                <span className="font-bold text-blue-900">{shiftsForMonth.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-blue-700">Полных дней:</span>
                <span className="font-bold text-blue-900">{shiftsForMonth.filter(s => s.is_full_day).length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-blue-700">Неполных дней:</span>
                <span className="font-bold text-blue-900">{shiftsForMonth.filter(s => !s.is_full_day).length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
