import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activityLog';
import { UserProfile, ShiftWithEmployee, Employee, ScheduleAssignment, Attraction } from '../types';
import {
  Loader2, Search, Edit2, Trash2, Plus, ChevronLeft, ChevronRight,
  Calendar, LayoutGrid, CalendarDays, Wand2, X, Users, Gamepad2, Clock
} from 'lucide-react';
import { format, parseISO, isSameDay, startOfMonth, endOfMonth, eachDayOfInterval, isBefore, startOfDay, addMonths, subMonths } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ScheduleGenerator } from './ScheduleGenerator';
import { EmployeesList } from './EmployeesList';
import { AttractionsList } from './AttractionsList';

type ViewMode = 'day' | 'week' | 'month';

interface AdminDashboardProps {
  profile: UserProfile;
  isSuperAdmin?: boolean;
}

// Функция для проверки, можно ли редактировать график (до 23:00 дня смены)
function canEditSchedule(workDate: string): boolean {
  const now = new Date();
  const date = parseISO(workDate);
  const deadline = new Date(date);
  deadline.setHours(23, 0, 0, 0);
  return now < deadline;
}

export function AdminDashboard({ profile, isSuperAdmin = false }: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'shifts' | 'schedule' | 'employees' | 'attractions'>('shifts');

  // --- Общие данные ---
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<ShiftWithEmployee[]>([]);       // employee_availability
  const [scheduleAssignments, setScheduleAssignments] = useState<ScheduleAssignment[]>([]); // schedule_assignments
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // --- Динамический выбор месяца/года ---
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(new Date().getMonth()); // 0-11

  // --- Режим отображения для вкладки "Управление сменами" ---
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(() => startOfMonth(new Date()));

  // --- Форма для employee_availability (старые смены) ---
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | ''>('');
  const [workDate, setWorkDate] = useState('');
  const [isFullDay, setIsFullDay] = useState(true);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [editingShiftId, setEditingShiftId] = useState<number | null>(null);
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // --- Форма для schedule_assignments (график от админа) ---
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [scheduleEmployeeId, setScheduleEmployeeId] = useState<number | ''>('');
  const [scheduleAttractionId, setScheduleAttractionId] = useState<number | ''>('');
  const [scheduleWorkDate, setScheduleWorkDate] = useState('');
  const [scheduleStartTime, setScheduleStartTime] = useState('');
  const [scheduleEndTime, setScheduleEndTime] = useState('');
  const [scheduleFormError, setScheduleFormError] = useState<string | null>(null);

  // Загрузка данных
  const fetchData = async () => {
    setLoading(true);
    try {
      // Сотрудники
      const { data: empData } = await supabase
        .from('employees')
        .select('id, full_name, age, base_hourly_rate')
        .order('full_name');
      if (empData) setEmployees(empData);

      // Аттракционы
      const { data: attrData } = await supabase
        .from('attractions')
        .select('id, name, coefficient');
      if (attrData) setAttractions(attrData);

      // Старые смены (employee_availability)
      const { data: shiftData } = await supabase
        .from('employee_availability')
        .select('id, employee_id, work_date, is_full_day, start_time, end_time, employees(full_name)')
        .order('work_date', { ascending: true });
      if (shiftData) setShifts(shiftData as unknown as ShiftWithEmployee[]);

      // График от администратора (schedule_assignments)
      const { data: scheduleData } = await supabase
        .from('schedule_assignments')
        .select(`
          id, work_date, employee_id, attraction_id, start_time, end_time,
          created_at, updated_at,
          employees(full_name),
          attractions(name, coefficient)
        `)
        .order('work_date', { ascending: true });
      if (scheduleData) setScheduleAssignments(scheduleData as ScheduleAssignment[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // --- Фильтрация для employee_availability ---
  const shiftsForMonth = useMemo(() => {
    return shifts.filter(s => {
      const d = parseISO(s.work_date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
  }, [shifts, currentYear, currentMonth]);

  const filteredShifts = useMemo(() => {
    let base = shiftsForMonth;
    if (viewMode === 'day') {
      base = base.filter(s => isSameDay(parseISO(s.work_date), selectedDate));
    } else if (viewMode === 'week') {
      const weekEnd = addDays(selectedWeekStart, 6);
      base = base.filter(s => {
        const d = parseISO(s.work_date);
        return d >= selectedWeekStart && d <= weekEnd;
      });
    }
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(s =>
      s.employees?.full_name?.toLowerCase().includes(q) ||
      s.work_date.includes(q)
    );
  }, [shiftsForMonth, viewMode, selectedDate, selectedWeekStart, search]);

  // --- Фильтрация для schedule_assignments ---
  const scheduleForMonth = useMemo(() => {
    return scheduleAssignments.filter(s => {
      const d = parseISO(s.work_date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
  }, [scheduleAssignments, currentYear, currentMonth]);

  // --- CRUD для employee_availability ---
  const resetShiftForm = () => {
    setEditingShiftId(null);
    setSelectedEmployeeId('');
    setWorkDate('');
    setIsFullDay(true);
    setStartTime('');
    setEndTime('');
    setFormError(null);
    setShowShiftForm(false);
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
    resetShiftForm();
    fetchData();
  };

  const handleEditShift = (shift: ShiftWithEmployee) => {
    setEditingShiftId(shift.id);
    setSelectedEmployeeId(shift.employee_id);
    setWorkDate(shift.work_date);
    setIsFullDay(shift.is_full_day);
    setStartTime(shift.start_time || '');
    setEndTime(shift.end_time || '');
    setShowShiftForm(true);
  };

  const handleDeleteShift = async (shift: ShiftWithEmployee) => {
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

  // --- CRUD для schedule_assignments ---
  const resetScheduleForm = () => {
    setEditingScheduleId(null);
    setScheduleEmployeeId('');
    setScheduleAttractionId('');
    setScheduleWorkDate('');
    setScheduleStartTime('');
    setScheduleEndTime('');
    setScheduleFormError(null);
    setShowScheduleForm(false);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleFormError(null);
    if (!scheduleEmployeeId) { setScheduleFormError('Выберите сотрудника'); return; }
    if (!scheduleAttractionId) { setScheduleFormError('Выберите аттракцион'); return; }
    if (!scheduleWorkDate) { setScheduleFormError('Укажите дату'); return; }
    if (!scheduleStartTime || !scheduleEndTime) { setScheduleFormError('Укажите время начала и окончания'); return; }
    if (scheduleStartTime >= scheduleEndTime) { setScheduleFormError('Время окончания должно быть позже начала'); return; }

    // Проверка на возможность редактирования (если редактируем существующую запись)
    if (editingScheduleId) {
      const existing = scheduleAssignments.find(s => s.id === editingScheduleId);
      if (existing && !canEditSchedule(existing.work_date)) {
        setScheduleFormError('Редактирование невозможно: прошло 23:00 дня смены');
        return;
      }
    }

    const scheduleData = {
      employee_id: Number(scheduleEmployeeId),
      attraction_id: Number(scheduleAttractionId),
      work_date: scheduleWorkDate,
      start_time: scheduleStartTime,
      end_time: scheduleEndTime,
    };

    const emp = employees.find(e => e.id === Number(scheduleEmployeeId));
    const attr = attractions.find(a => a.id === Number(scheduleAttractionId));

    if (editingScheduleId) {
      const { error } = await supabase
        .from('schedule_assignments')
        .update(scheduleData)
        .eq('id', editingScheduleId);
      if (error) { setScheduleFormError('Ошибка при сохранении'); return; }
      await logActivity(
        isSuperAdmin ? 'superadmin' : 'admin', profile.id, 'schedule_update',
        `Обновлено назначение: сотрудник ${emp?.full_name} на аттракцион ${attr?.name} ${scheduleWorkDate}`
      );
    } else {
      const { error } = await supabase.from('schedule_assignments').insert([scheduleData]);
      if (error) { setScheduleFormError('Ошибка при добавлении'); return; }
      await logActivity(
        isSuperAdmin ? 'superadmin' : 'admin', profile.id, 'schedule_add',
        `Добавлено назначение: сотрудник ${emp?.full_name} на аттракцион ${attr?.name} ${scheduleWorkDate}`
      );
    }
    resetScheduleForm();
    fetchData();
  };

  const handleEditSchedule = (schedule: ScheduleAssignment) => {
    if (!canEditSchedule(schedule.work_date)) {
      alert('Редактирование невозможно: прошло 23:00 дня смены');
      return;
    }
    setEditingScheduleId(schedule.id);
    setScheduleEmployeeId(schedule.employee_id);
    setScheduleAttractionId(schedule.attraction_id);
    setScheduleWorkDate(schedule.work_date);
    setScheduleStartTime(schedule.start_time.slice(0,5));
    setScheduleEndTime(schedule.end_time.slice(0,5));
    setShowScheduleForm(true);
  };

  const handleDeleteSchedule = async (schedule: ScheduleAssignment) => {
    if (!canEditSchedule(schedule.work_date)) {
      alert('Удаление невозможно: прошло 23:00 дня смены');
      return;
    }
    if (!confirm('Удалить назначение?')) return;
    const { error } = await supabase.from('schedule_assignments').delete().eq('id', schedule.id);
    if (!error) {
      await logActivity(
        isSuperAdmin ? 'superadmin' : 'admin', profile.id, 'schedule_delete',
        `Удалено назначение для сотрудника ${schedule.employees?.full_name} на ${schedule.work_date}`
      );
      fetchData();
    }
  };

  // --- Навигация по месяцам/годам ---
  const handlePrevMonth = () => {
    const newDate = subMonths(new Date(currentYear, currentMonth, 1), 1);
    setCurrentYear(newDate.getFullYear());
    setCurrentMonth(newDate.getMonth());
  };
  const handleNextMonth = () => {
    const newDate = addMonths(new Date(currentYear, currentMonth, 1), 1);
    setCurrentYear(newDate.getFullYear());
    setCurrentMonth(newDate.getMonth());
  };

  const monthLabel = format(new Date(currentYear, currentMonth, 1), 'LLLL yyyy', { locale: ru });

  // Вспомогательные функции для недельного отображения
  const getWeeksInMonth = () => {
    const start = startOfMonth(new Date(currentYear, currentMonth, 1));
    const end = endOfMonth(start);
    const weeks: Date[][] = [];
    let current = startOfMonth(start);
    while (current <= end) {
      const weekStart = startOfWeek(current, { weekStartsOn: 1 });
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(addDays(weekStart, i));
      }
      weeks.push(week);
      current = addDays(weekStart, 7);
    }
    return weeks;
  };
  const weeksInMonth = useMemo(() => getWeeksInMonth(), [currentYear, currentMonth]);
  const currentWeekIndex = useMemo(() => {
    return weeksInMonth.findIndex(week => week.some(day => isSameDay(day, selectedWeekStart)));
  }, [weeksInMonth, selectedWeekStart]);

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
            Управление сменами (старые)
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
            График (новый)
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

        {/* ========== ВКЛАДКА "Управление сменами (старые)" ========== */}
        {activeTab === 'shifts' && (
          <div className="p-6 space-y-6">
            {/* Навигация по месяцам */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={handlePrevMonth} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-lg font-semibold text-gray-800">{monthLabel}</span>
              <button onClick={handleNextMonth} className="p-2 rounded-lg hover:bg-gray-100">
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Режим отображения */}
            <div className="flex items-center gap-2 justify-center">
              <span className="text-sm text-gray-500">Вид:</span>
              {(['day', 'week', 'month'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    viewMode === mode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {mode === 'day' && <><CalendarDays className="h-3.5 w-3.5" />День</>}
                  {mode === 'week' && <><LayoutGrid className="h-3.5 w-3.5" />Неделя</>}
                  {mode === 'month' && <><Calendar className="h-3.5 w-3.5" />Месяц</>}
                </button>
              ))}
            </div>

            {/* Дополнительные элементы навигации для дня/недели */}
            {viewMode === 'day' && (
              <div className="flex items-center justify-center gap-3">
                <button onClick={() => setSelectedDate(d => addDays(d, -1))} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <input
                  type="date"
                  value={format(selectedDate, 'yyyy-MM-dd')}
                  onChange={e => setSelectedDate(parseISO(e.target.value))}
                  className="border rounded-lg px-3 py-1.5 text-sm"
                />
                <button onClick={() => setSelectedDate(d => addDays(d, 1))} className="p-1.5 rounded-lg hover:bg-gray-100">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {viewMode === 'week' && weeksInMonth.length > 0 && (
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    const idx = currentWeekIndex;
                    if (idx > 0) setSelectedWeekStart(weeksInMonth[idx-1][0]);
                  }}
                  disabled={currentWeekIndex <= 0}
                  className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-medium">
                  Неделя {currentWeekIndex + 1} / {weeksInMonth.length}
                </div>
                <button
                  onClick={() => {
                    const idx = currentWeekIndex;
                    if (idx < weeksInMonth.length - 1) setSelectedWeekStart(weeksInMonth[idx+1][0]);
                  }}
                  disabled={currentWeekIndex >= weeksInMonth.length - 1}
                  className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Поиск и кнопка добавления */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Поиск по ФИО или дате..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <button
                onClick={() => { resetShiftForm(); setShowShiftForm(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Добавить смену (старый формат)
              </button>
            </div>

            {/* Форма для старых смен */}
            {showShiftForm && (
              <div className="bg-gray-50 border rounded-xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-semibold">{editingShiftId ? 'Редактировать смену' : 'Добавить смену'}</h4>
                  <button onClick={resetShiftForm} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
                </div>
                <form onSubmit={handleSaveShift} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Сотрудник</label>
                      <select
                        required value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(Number(e.target.value) || '')}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">— Выберите —</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Дата</label>
                      <input type="date" required value={workDate} onChange={e => setWorkDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="flex items-center pt-6">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={isFullDay} onChange={e => setIsFullDay(e.target.checked)} className="h-4 w-4" />
                        <span className="text-sm">Полный день</span>
                      </label>
                    </div>
                  </div>
                  {!isFullDay && (
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="block text-sm font-medium mb-1">Начало</label><input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                      <div><label className="block text-sm font-medium mb-1">Конец</label><input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                    </div>
                  )}
                  {formError && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{formError}</div>}
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={resetShiftForm} className="px-4 py-2 border rounded-lg text-sm">Отмена</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-2">
                      {editingShiftId ? <><Edit2 className="h-4 w-4" />Сохранить</> : <><Plus className="h-4 w-4" />Добавить</>}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Таблица старых смен */}
            <div className="overflow-x-auto border rounded-xl">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr><th className="px-4 py-3 text-left text-xs font-semibold">Сотрудник</th><th>Дата</th><th>Смена</th><th className="text-right">Действия</th></tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {filteredShifts.map(shift => (
                    <tr key={shift.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{shift.employees?.full_name || '—'}</td>
                      <td className="px-4 py-3 text-sm">{format(parseISO(shift.work_date), 'dd.MM.yyyy')} <span className="text-xs text-gray-400 ml-1">{format(parseISO(shift.work_date), 'EEE', { locale: ru })}</span></td>
                      <td className="px-4 py-3 text-sm">{shift.is_full_day ? <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded-full text-xs">Полный день</span> : <span className="bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full text-xs">{shift.start_time?.slice(0,5)}–{shift.end_time?.slice(0,5)}</span>}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleEditShift(shift)} className="text-blue-600 p-1.5 rounded-lg hover:bg-blue-50"><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteShift(shift)} className="text-red-500 p-1.5 rounded-lg hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {filteredShifts.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-gray-400">Смен не найдено</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========== ВКЛАДКА "График (новый)" ========== */}
        {activeTab === 'schedule' && (
          <div className="p-6 space-y-6">
            {/* Навигация по месяцам (такая же) */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={handlePrevMonth} className="p-2 rounded-lg hover:bg-gray-100"><ChevronLeft className="h-5 w-5" /></button>
              <span className="text-lg font-semibold text-gray-800">{monthLabel}</span>
              <button onClick={handleNextMonth} className="p-2 rounded-lg hover:bg-gray-100"><ChevronRight className="h-5 w-5" /></button>
            </div>

            {/* Кнопка добавления нового назначения */}
            <div className="flex justify-end">
              <button
                onClick={() => { resetScheduleForm(); setShowScheduleForm(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Добавить назначение
              </button>
            </div>

            {/* Форма для schedule_assignments */}
            {showScheduleForm && (
              <div className="bg-gray-50 border rounded-xl p-5">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="font-semibold">{editingScheduleId ? 'Редактировать назначение' : 'Добавить назначение'}</h4>
                  <button onClick={resetScheduleForm} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
                </div>
                <form onSubmit={handleSaveSchedule} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div><label className="block text-sm font-medium mb-1">Сотрудник</label><select required value={scheduleEmployeeId} onChange={e => setScheduleEmployeeId(Number(e.target.value) || '')} className="w-full border rounded-lg px-3 py-2 text-sm"><option value="">— Выберите —</option>{employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></div>
                    <div><label className="block text-sm font-medium mb-1">Аттракцион</label><select required value={scheduleAttractionId} onChange={e => setScheduleAttractionId(Number(e.target.value) || '')} className="w-full border rounded-lg px-3 py-2 text-sm"><option value="">— Выберите —</option>{attractions.map(a => <option key={a.id} value={a.id}>{a.name} (коэфф. {a.coefficient})</option>)}</select></div>
                    <div><label className="block text-sm font-medium mb-1">Дата</label><input type="date" required value={scheduleWorkDate} onChange={e => setScheduleWorkDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                    <div className="grid grid-cols-2 gap-2"><div><label className="block text-sm font-medium mb-1">Начало</label><input type="time" required value={scheduleStartTime} onChange={e => setScheduleStartTime(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div><div><label className="block text-sm font-medium mb-1">Конец</label><input type="time" required value={scheduleEndTime} onChange={e => setScheduleEndTime(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div></div>
                  </div>
                  {scheduleFormError && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{scheduleFormError}</div>}
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={resetScheduleForm} className="px-4 py-2 border rounded-lg text-sm">Отмена</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-2">{editingScheduleId ? <><Edit2 className="h-4 w-4" />Сохранить</> : <><Plus className="h-4 w-4" />Добавить</>}</button>
                  </div>
                </form>
              </div>
            )}

            {/* Таблица назначений */}
            <div className="overflow-x-auto border rounded-xl">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr><th className="px-4 py-3 text-left text-xs font-semibold">Сотрудник</th><th>Аттракцион</th><th>Дата</th><th>Время</th><th className="text-right">Действия</th></tr>
                </thead>
                <tbody className="divide-y bg-white">
                  {scheduleForMonth.map(s => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{s.employees?.full_name || '—'}</td>
                      <td className="px-4 py-3 text-sm">{s.attractions?.name || '—'} <span className="text-xs text-gray-400">(x{s.attractions?.coefficient})</span></td>
                      <td className="px-4 py-3 text-sm">{format(parseISO(s.work_date), 'dd.MM.yyyy')}</td>
                      <td className="px-4 py-3 text-sm">{s.start_time.slice(0,5)} – {s.end_time.slice(0,5)}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleEditSchedule(s)} className="text-blue-600 p-1.5 rounded-lg hover:bg-blue-50" disabled={!canEditSchedule(s.work_date)}><Edit2 className="h-4 w-4" /></button>
                        <button onClick={() => handleDeleteSchedule(s)} className="text-red-500 p-1.5 rounded-lg hover:bg-red-50" disabled={!canEditSchedule(s.work_date)}><Trash2 className="h-4 w-4" /></button>
                        {!canEditSchedule(s.work_date) && <span className="text-xs text-gray-400 ml-2">(блок)</span>}
                      </td>
                    </tr>
                  ))}
                  {scheduleForMonth.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-gray-400">Нет назначений на этот месяц</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Дополнительно можно отобразить генератор графика (если он нужен) */}
            <div className="mt-8 border-t pt-6">
              <h3 className="text-lg font-semibold mb-3">Генератор графика (автоматическое создание)</h3>
              <ScheduleGenerator profile={profile} isSuperAdmin={isSuperAdmin} onScheduleGenerated={fetchData} />
            </div>
          </div>
        )}

        {/* Вкладка "Сотрудники" – передаём обновлённые пропсы для редактирования ставки */}
        {activeTab === 'employees' && (
          <div className="p-6">
            <EmployeesList isSuperAdmin={isSuperAdmin} onEmployeeUpdate={fetchData} />
          </div>
        )}

        {/* Вкладка "Аттракционы" – передаём пропсы для редактирования коэффициента */}
        {activeTab === 'attractions' && (
          <div className="p-6">
            <AttractionsList isSuperAdmin={isSuperAdmin} onAttractionUpdate={fetchData} />
          </div>
        )}
      </div>
    </div>
  );
}
