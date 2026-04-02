import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activityLog';
import { UserProfile, ShiftWithEmployee, Employee } from '../types';
import {
  Loader2, Search, Edit2, Trash2, Plus, ChevronLeft, ChevronRight,
  Calendar, LayoutGrid, CalendarDays, Wand2, X, Users, Gamepad2
} from 'lucide-react';
import { format, startOfWeek, addDays, parseISO, isSameDay, startOfMonth, addWeeks } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ScheduleGenerator } from './ScheduleGenerator';
import { EmployeesList } from './EmployeesList';
import { AttractionsList } from './AttractionsList';

// Доступные месяцы
const MONTHS = [
  { value: 3, label: 'Апрель', year: 2025 },
  { value: 4, label: 'Май', year: 2025 },
  { value: 5, label: 'Июнь', year: 2025 },
  { value: 6, label: 'Июль', year: 2025 },
  { value: 7, label: 'Август', year: 2025 },
  { value: 8, label: 'Сентябрь', year: 2025 },
];

type ViewMode = 'day' | 'week' | 'month';

interface AdminDashboardProps {
  profile: UserProfile;
  isSuperAdmin?: boolean;
}

export function AdminDashboard({ profile, isSuperAdmin = false }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'shifts' | 'schedule' | 'employees' | 'attractions'>('shifts');

  // Управление сменами состояние
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<ShiftWithEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Выбранный месяц
  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number>(() => {
    const cur = new Date().getMonth();
    const found = MONTHS.find(m => m.value === cur);
    return found ? found.value : MONTHS[0].value;
  });

  // Режим отображения
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedWeek, setSelectedWeek] = useState<number>(0);

  // Форма смен
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | ''>('');
  const [workDate, setWorkDate] = useState('');
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [editingShiftId, setEditingShiftId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: empData } = await supabase
      .from('employees')
      .select('id, full_name, age')
      .order('full_name');
    if (empData) setEmployees(empData);

    const { data: shiftData } = await supabase
      .from('employee_availability')
      .select('id, employee_id, work_date, is_full_day, start_time, end_time, employees(full_name)')
      .order('work_date', { ascending: true });
    if (shiftData) setShifts(shiftData as unknown as ShiftWithEmployee[]);

    setLoading(false);
  };

  const getYearForMonth = (mi: number) => MONTHS.find(m => m.value === mi)?.year ?? 2025;

  const weeksInMonth = useMemo(() => {
    const year = getYearForMonth(selectedMonthIdx);
    const first = startOfMonth(new Date(year, selectedMonthIdx, 1));
    const weeks: Date[][] = [];
    let current = startOfWeek(first, { weekStartsOn: 1 });
    for (let w = 0; w < 5; w++) {
      const days: Date[] = [];
      for (let d = 0; d < 7; d++) {
        days.push(addDays(current, d));
      }
      weeks.push(days);
      current = addWeeks(current, 1);
    }
    return weeks;
  }, [selectedMonthIdx]);

  const shiftsForMonth = useMemo(() =>
    shifts.filter(s => {
      const d = parseISO(s.work_date);
      return d.getMonth() === selectedMonthIdx;
    }), [shifts, selectedMonthIdx]);

  const filteredShifts = useMemo(() => {
    const base = viewMode === 'month' ? shiftsForMonth :
      viewMode === 'week' ? shiftsForMonth.filter(s => {
        const d = parseISO(s.work_date);
        const week = weeksInMonth[selectedWeek] || [];
        return week.some(wd => isSameDay(wd, d));
      }) :
      shiftsForMonth.filter(s => isSameDay(parseISO(s.work_date), selectedDate));

    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(s =>
      s.employees?.full_name?.toLowerCase().includes(q) ||
      s.work_date.includes(q)
    );
  }, [shifts, shiftsForMonth, viewMode, selectedWeek, selectedDate, weeksInMonth, search]);

  const resetForm = () => {
    setEditingShiftId(null);
    setSelectedEmployeeId('');
    setWorkDate('');
    setIsFullDay(true);
    setStartTime('');
    setEndTime('');
    setFormError(null);
    setShowForm(false);
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!selectedEmployeeId) { setFormError('Выберите сотрудника'); return; }
    if (!workDate) { setFormError('Укажите дату'); return; }
    if (!isFullDay && (!startTime || !endTime)) { setFormError('Укажите время'); return; }

    const shiftData = {
      employee_id: Number(selectedEmployeeId),
      work_date: workDate,
      is_full_day: isFullDay,
      start_time: isFullDay ? null : startTime,
      end_time: isFullDay ? null : endTime,
    };

    const emp = employees.find(e => e.id === Number(selectedEmployeeId));

    if (editingShiftId) {
      const { error } = await supabase.from('employee_availability').update(shiftData).eq('id', editingShiftId);
      if (error) { setFormError('Ошибка при сохранении'); return; }
      await logActivity(
        isSuperAdmin ? 'superadmin' : 'admin', profile.id, 'shift_update',
        `Смена сотрудника ${emp?.full_name} на ${workDate} обновлена`
      );
    } else {
      const { error } = await supabase.from('employee_availability').insert([shiftData]);
      if (error) { setFormError('Ошибка при добавлении'); return; }
      await logActivity(
        isSuperAdmin ? 'superadmin' : 'admin', profile.id, 'shift_add',
        `Смена добавлена сотруднику ${emp?.full_name} на ${workDate}`
      );
    }

    resetForm();
    fetchData();
  };

  const handleEdit = (shift: ShiftWithEmployee) => {
    setEditingShiftId(shift.id);
    setSelectedEmployeeId(shift.employee_id);
    setWorkDate(shift.work_date);
    setIsFullDay(shift.is_full_day);
    setStartTime(shift.start_time || '');
    setEndTime(shift.end_time || '');
    setFormError(null);
    setShowForm(true);
  };

  const handleDelete = async (shift: ShiftWithEmployee) => {
    if (!confirm('Удалить смену?')) return;
    const { error } = await supabase.from('employee_availability').delete().eq('id', shift.id);
    if (!error) {
      await logActivity(
        isSuperAdmin ? 'superadmin' : 'admin', profile.id, 'shift_delete',
        `Смена сотрудника ${shift.employees?.full_name} на ${shift.work_date} удалена`
      );
      fetchData();
    }
  };

  const currentMonth = MONTHS.find(m => m.value === selectedMonthIdx);
  const currentMonthListIdx = MONTHS.findIndex(m => m.value === selectedMonthIdx);

  if (loading) return (
    <div className="flex justify-center p-16">
      <Loader2 className="animate-spin text-blue-600 h-8 w-8" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Вкладки */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex flex-wrap border-b border-gray-200">
          <button
            onClick={() => setActiveTab('shifts')}
            className={`flex-1 sm:flex-none px-6 py-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'shifts'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Calendar className="h-4 w-4" />
            Управление сменами
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 sm:flex-none px-6 py-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'schedule'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Wand2 className="h-4 w-4" />
            Генератор графика
          </button>
          <button
            onClick={() => setActiveTab('employees')}
            className={`flex-1 sm:flex-none px-6 py-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'employees'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Users className="h-4 w-4" />
            Сотрудники
          </button>
          <button
            onClick={() => setActiveTab('attractions')}
            className={`flex-1 sm:flex-none px-6 py-4 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition ${
              activeTab === 'attractions'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Gamepad2 className="h-4 w-4" />
            Аттракционы
          </button>
        </div>

        {activeTab === 'shifts' && (
          <div className="p-6 space-y-6">
            {/* Выбор месяца */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => currentMonthListIdx > 0 && setSelectedMonthIdx(MONTHS[currentMonthListIdx - 1].value)}
                  disabled={currentMonthListIdx === 0}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft className="h-5 w-5 text-gray-600" />
                </button>
                <span className="text-base font-semibold text-gray-800">{currentMonth?.label} {currentMonth?.year}</span>
                <button
                  onClick={() => currentMonthListIdx < MONTHS.length - 1 && setSelectedMonthIdx(MONTHS[currentMonthListIdx + 1].value)}
                  disabled={currentMonthListIdx === MONTHS.length - 1}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight className="h-5 w-5 text-gray-600" />
                </button>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {MONTHS.map(m => (
                  <button
                    key={m.value}
                    onClick={() => { setSelectedMonthIdx(m.value); setSelectedWeek(0); }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                      selectedMonthIdx === m.value
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Режим отображения */}
            <div className="flex items-center gap-2 justify-center">
              <span className="text-sm text-gray-500 mr-2">Вид:</span>
              {(['day', 'week', 'month'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    viewMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {mode === 'day' && <><CalendarDays className="h-3.5 w-3.5" />День</>}
                  {mode === 'week' && <><ChevronRight className="h-3.5 w-3.5" />Неделя</>}
                  {mode === 'month' && <><LayoutGrid className="h-3.5 w-3.5" />Месяц</>}
                </button>
              ))}
            </div>

            {/* Навигация по дням/неделям */}
            {viewMode === 'week' && (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setSelectedWeek(w => Math.max(0, w - 1))}
                  disabled={selectedWeek === 0}
                  className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="flex gap-2">
                  {weeksInMonth.map((_, wi) => (
                    <button
                      key={wi}
                      onClick={() => setSelectedWeek(wi)}
                      className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                        selectedWeek === wi ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {wi + 1} нед.
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setSelectedWeek(w => Math.min(weeksInMonth.length - 1, w + 1))}
                  disabled={selectedWeek === weeksInMonth.length - 1}
                  className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 transition"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {viewMode === 'week' && weeksInMonth[selectedWeek] && (
              <div className="grid grid-cols-7 gap-1">
                {weeksInMonth[selectedWeek].map((day, di) => (
                  <div key={di} className={`rounded-lg p-2 text-center text-xs font-medium ${
                    day.getMonth() === selectedMonthIdx ? 'bg-gray-50 border border-gray-200' : 'bg-gray-50 text-gray-300 border border-gray-100'
                  }`}>
                    <div className="text-gray-400 mb-1">{format(day, 'EEE', { locale: ru })}</div>
                    <div className={day.getMonth() === selectedMonthIdx ? 'text-gray-800 font-bold' : 'text-gray-300'}>
                      {format(day, 'd')}
                    </div>
                    {day.getMonth() === selectedMonthIdx && (
                      <div className="mt-1">
                        {shiftsForMonth.filter(s => isSameDay(parseISO(s.work_date), day)).length > 0 && (
                          <span className="bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5">
                            {shiftsForMonth.filter(s => isSameDay(parseISO(s.work_date), day)).length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'day' && (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setSelectedDate(d => addDays(d, -1))}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={e => setSelectedDate(parseISO(e.target.value))}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => setSelectedDate(d => addDays(d, 1))}
                  className="p-1.5 rounded-lg hover:bg-gray-100 transition"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Кнопка добавить + поиск */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Поиск по ФИО или дате..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
              >
                <Plus className="h-4 w-4" />
                Добавить смену
              </button>
            </div>

            {/* Форма */}
            {showForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-gray-800">
                    {editingShiftId ? 'Редактировать смену' : 'Добавить смену'}
                  </h4>
                  <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <form onSubmit={handleSaveShift} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Сотрудник</label>
                      <select
                        required
                        value={selectedEmployeeId}
                        onChange={e => setSelectedEmployeeId(Number(e.target.value) || '')}
                        className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="">— Выберите —</option>
                        {employees.map(e => (
                          <option key={e.id} value={e.id}>{e.full_name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Дата смены</label>
                      <input
                        type="date"
                        required
                        value={workDate}
                        onChange={e => setWorkDate(e.target.value)}
                        className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex items-center pt-6">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isFullDay}
                          onChange={e => setIsFullDay(e.target.checked)}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                        />
                        <span className="ml-2 text-sm text-gray-700">Полный день</span>
                      </label>
                    </div>
                  </div>

                  {!isFullDay && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Начало</label>
                        <input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)}
                          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Конец</label>
                        <input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)}
                          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>
                  )}

                  {formError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{formError}</div>
                  )}

                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={resetForm}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition">
                      Отмена
                    </button>
                    <button type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 transition">
                      {editingShiftId ? <><Edit2 className="h-4 w-4" />Сохранить</> : <><Plus className="h-4 w-4" />Добавить</>}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Таблица смен */}
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Сотрудник</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Дата</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Смена</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filteredShifts.map(shift => (
                    <tr key={shift.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {shift.employees?.full_name || 'Неизвестно'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {format(parseISO(shift.work_date), 'dd.MM.yyyy')}
                        <span className="ml-2 text-xs text-gray-400">
                          {format(parseISO(shift.work_date), 'EEE', { locale: ru })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {shift.is_full_day ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Полный день</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                            {shift.start_time?.slice(0, 5)} – {shift.end_time?.slice(0, 5)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleEdit(shift)}
                          className="text-blue-600 hover:text-blue-800 p-1.5 rounded-lg hover:bg-blue-50 transition mr-1">
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleDelete(shift)}
                          className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredShifts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">
                        <Calendar className="mx-auto h-8 w-8 mb-2 opacity-40" />
                        Смены не найдены
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="text-sm text-gray-500 text-right">
              Показано: {filteredShifts.length} смен
            </div>
          </div>
        )}

        {activeTab === 'schedule' && (
          <div className="p-6">
            <ScheduleGenerator profile={profile} isSuperAdmin={isSuperAdmin} />
          </div>
        )}

        {activeTab === 'employees' && (
          <div className="p-6">
            <EmployeesList isSuperAdmin={isSuperAdmin} />
          </div>
        )}

        {activeTab === 'attractions' && (
          <div className="p-6">
            <AttractionsList isSuperAdmin={isSuperAdmin} />
          </div>
        )}
      </div>
    </div>
  );
}
