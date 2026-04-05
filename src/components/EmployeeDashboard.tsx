import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logActivity } from '../lib/activityLog';
import { UserProfile, Shift, Priority } from '../types';
import { getRandomGreeting } from '../utils/greetings';
import { format, isBefore, startOfDay, parseISO, addMonths, subMonths, differenceInMinutes, differenceInHours } from 'date-fns';
import { ru } from 'date-fns/locale';
import { 
  Loader2, Calendar, Star, Map, ChevronLeft, ChevronRight,
  Plus, Trash2, X, AlertCircle, Clock, FileText, MessageCircle,
  CheckCircle, DollarSign, History, User
} from 'lucide-react';

// ======================== ТИПЫ ========================
interface ScheduleAssignment {
  id: number;
  work_date: string;
  employee_id: number;
  attraction_id: number;
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
  attractions?: { name: string; coefficient: number };
}

interface ActualWorkLog {
  id: number;
  schedule_assignment_id: number;
  actual_start: string;
  actual_end: string;
  created_at: string;
}

interface StudyGoal {
  id: number;
  attraction_id: number;
  change_count: number;
  change_history: number[];
  attractions?: { name: string };
}

// Расширенный профиль с базовой ставкой
interface EmployeeProfile extends UserProfile {
  base_hourly_rate: number;
}

// Вспомогательные функции
function formatDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

// Ограничения на удаление старых смен (employee_availability)
function canDeleteShift(shift: Shift): { allowed: boolean; reason?: string } {
  const now = new Date();
  const today = startOfDay(now);
  const shiftDate = parseISO(shift.work_date);
  const shiftDay = startOfDay(shiftDate);

  if (isBefore(shiftDay, today) || shiftDay.getTime() === today.getTime()) {
    return { allowed: false, reason: 'Нельзя удалить прошедшую или текущую смену' };
  }

  const startTimeStr = shift.is_full_day ? '00:00:00' : (shift.start_time || '00:00:00');
  const shiftStart = new Date(`${shift.work_date}T${startTimeStr}`);
  const diffHours = (shiftStart.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (diffHours < 22) {
    return { allowed: false, reason: 'До начала смены менее 22 часов — удаление невозможно' };
  }

  return { allowed: true };
}

function isDateActive(dateStr: string): boolean {
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  if (dateStr < todayStr) return false;
  if (dateStr === todayStr && now.getHours() >= 9) return false;
  return true;
}

// ======================== ОСНОВНОЙ КОМПОНЕНТ ========================
interface EmployeeDashboardProps {
  profile: EmployeeProfile;
}

export function EmployeeDashboard({ profile }: EmployeeDashboardProps) {
  // ------ Состояния для дат и загрузки ------
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shifts, setShifts] = useState<Shift[]>([]);               // старые смены employee_availability
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [studyGoal, setStudyGoal] = useState<StudyGoal | null>(null);
  const [availableAttractions, setAvailableAttractions] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [greeting, setGreeting] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'shifts' | 'priorities' | 'form' | 'salary'>('dashboard');
  const [ping, setPing] = useState(120);

  // ------ Новые данные (график от администратора и отметки) ------
  const [scheduleAssignments, setScheduleAssignments] = useState<ScheduleAssignment[]>([]);
  const [actualLogs, setActualLogs] = useState<ActualWorkLog[]>([]);

  // ------ Модалки ------
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [modalDate, setModalDate] = useState('');
  const [isFullDayModal, setIsFullDayModal] = useState(true);
  const [modalStartTime, setModalStartTime] = useState('10:00');
  const [modalEndTime, setModalEndTime] = useState('22:00');
  const [modalComment, setModalComment] = useState('');
  const [modalError, setModalError] = useState('');
  const [savingShift, setSavingShift] = useState(false);

  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewShift, setViewShift] = useState<Shift | null>(null);

  // Модалка для отметки фактического времени
  const [isTimeLogModalOpen, setIsTimeLogModalOpen] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleAssignment | null>(null);
  const [actualStart, setActualStart] = useState('');
  const [actualEnd, setActualEnd] = useState('');
  const [timeLogError, setTimeLogError] = useState('');
  const [savingTimeLog, setSavingTimeLog] = useState(false);

  // Состояния для цели изучения
  const [selectedAttractionId, setSelectedAttractionId] = useState<number | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalError, setGoalError] = useState('');

  // Состояния для расчёта зарплаты
  const [salaryPeriod, setSalaryPeriod] = useState<'first' | 'second'>('first'); // first: 7-21, second: 22-6
  const [salaryData, setSalaryData] = useState<{ days: any[]; total: number } | null>(null);
  const [loadingSalary, setLoadingSalary] = useState(false);

  // Временные интервалы для выбора (10:00-20:00)
  const START_TIMES = (() => {
    const times: string[] = [];
    for (let h = 10; h <= 20; h++) {
      for (let m of [0, 15, 30, 45]) {
        if (h === 20 && m > 0) continue;
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return times;
  })();

  const END_TIMES = (() => {
    const times: string[] = [];
    for (let h = 12; h <= 23; h++) {
      for (let m of [0, 15, 30, 45]) {
        if (h === 23 && m > 0) continue;
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return times;
  })();

  // Живые часы и пинг
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setPing(prev => {
        let newPing = prev + (Math.random() * 30) - 15;
        newPing = Math.min(458, Math.max(78, newPing));
        return Math.round(newPing);
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (profile.full_name) {
      setGreeting(getRandomGreeting(profile.full_name, new Date()));
    }
  }, [profile.full_name]);

  // Загрузка всех данных
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Старые смены
      const { data: shiftData } = await supabase
        .from('employee_availability')
        .select('id, employee_id, work_date, is_full_day, start_time, end_time, comment')
        .eq('employee_id', profile.id)
        .order('work_date');
      if (shiftData) setShifts(shiftData as Shift[]);

      // 2. Приоритеты
      const { data: prioData } = await supabase
        .from('employee_attraction_priorities')
        .select('id, priority_level, attraction_id, attractions(name)')
        .eq('employee_id', profile.id)
        .order('priority_level');
      if (prioData) setPriorities(prioData as unknown as Priority[]);

      // 3. Цель изучения
      const { data: goalData } = await supabase
        .from('employee_study_goals')
        .select('id, attraction_id, change_count, change_history, attractions(name)')
        .eq('employee_id', profile.id)
        .maybeSingle();
      if (goalData) {
        setStudyGoal(goalData as StudyGoal);
        setSelectedAttractionId(goalData.attraction_id);
      } else {
        setStudyGoal(null);
        setSelectedAttractionId(null);
      }

      // 4. Доступные аттракционы (без приоритетов)
      const attractionIdsWithPriority = prioData?.map(p => p.attraction_id) || [];
      const { data: allAttractions } = await supabase
        .from('attractions')
        .select('id, name')
        .not('id', 'in', `(${attractionIdsWithPriority.join(',') || 0})`);
      setAvailableAttractions(allAttractions || []);

      // 5. График от администратора (schedule_assignments)
      const { data: scheduleData } = await supabase
        .from('schedule_assignments')
        .select(`
          id, work_date, employee_id, attraction_id, start_time, end_time,
          created_at, updated_at,
          attractions ( name, coefficient )
        `)
        .eq('employee_id', profile.id)
        .order('work_date', { ascending: true });
      if (scheduleData) setScheduleAssignments(scheduleData as ScheduleAssignment[]);

      // 6. Фактические отметки времени
      const { data: logsData } = await supabase
        .from('actual_work_log')
        .select('*')
        .in('schedule_assignment_id', (scheduleData || []).map(s => s.id));
      if (logsData) setActualLogs(logsData as ActualWorkLog[]);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Фильтры для отображения
  const shiftsForMonth = useMemo(() => {
    return shifts.filter(s => {
      const d = parseISO(s.work_date);
      return d.getFullYear() === currentDate.getFullYear() && d.getMonth() === currentDate.getMonth();
    });
  }, [shifts, currentDate]);

  const scheduleForMonth = useMemo(() => {
    return scheduleAssignments.filter(s => {
      const d = parseISO(s.work_date);
      return d.getFullYear() === currentDate.getFullYear() && d.getMonth() === currentDate.getMonth();
    });
  }, [scheduleAssignments, currentDate]);

  const occupiedDates = useMemo(() => new Set(shifts.map(s => s.work_date)), [shifts]);

  // --- Работа со старыми сменами (employee_availability) ---
  const handleDeleteShift = async (shift: Shift) => {
    const { allowed, reason } = canDeleteShift(shift);
    if (!allowed) { alert(reason); return; }
    if (!confirm('Удалить смену?')) return;
    const { error } = await supabase.from('employee_availability').delete().eq('id', shift.id);
    if (!error) {
      await logActivity('employee', profile.id, 'shift_delete', `Сотрудник ${profile.full_name} удалил смену на ${shift.work_date}`);
      await fetchData();
      setIsViewModalOpen(false);
    } else alert('Ошибка при удалении');
  };

  const openAddModal = (dateStr: string) => {
    if (occupiedDates.has(dateStr)) {
      alert('На эту дату уже установлена смена. Нажмите на смену для просмотра.');
      return;
    }
    setModalDate(dateStr);
    setIsFullDayModal(true);
    setModalStartTime(START_TIMES[0]);
    setModalEndTime(END_TIMES[0]);
    setModalComment('');
    setModalError('');
    setIsAddModalOpen(true);
  };

  const openViewModal = (shift: Shift) => {
    setViewShift(shift);
    setIsViewModalOpen(true);
  };

  const handleAddShift = async () => {
    setModalError('');
    if (!modalDate) return;
    if (!isFullDayModal && modalStartTime >= modalEndTime) {
      setModalError('Время окончания должно быть позже начала');
      return;
    }
    if (modalComment.length > 4096) {
      setModalError('Комментарий не более 4096 символов');
      return;
    }
    setSavingShift(true);
    const newShift = {
      employee_id: profile.id,
      work_date: modalDate,
      is_full_day: isFullDayModal,
      start_time: isFullDayModal ? null : modalStartTime + ':00',
      end_time: isFullDayModal ? null : modalEndTime + ':00',
      comment: modalComment.trim() || null,
    };
    const { error } = await supabase.from('employee_availability').insert([newShift]);
    if (!error) {
      await logActivity('employee', profile.id, 'shift_add', `Добавил смену на ${modalDate}`);
      await fetchData();
      setIsAddModalOpen(false);
    } else setModalError('Ошибка при добавлении');
    setSavingShift(false);
  };

  // --- Работа с графиком (отметка фактического времени) ---
  const openTimeLogModal = (schedule: ScheduleAssignment) => {
    // Проверяем, можно ли отмечать (для сегодняшнего дня после 22:00, для прошлых всегда)
    const workDate = parseISO(schedule.work_date);
    const today = startOfDay(new Date());
    const nowTime = new Date();
    if (workDate.getTime() === today.getTime() && nowTime.getHours() < 22) {
      alert('Отметить фактическое время для сегодняшней смены можно только после 22:00');
      return;
    }
    const existingLog = actualLogs.find(log => log.schedule_assignment_id === schedule.id);
    if (existingLog) {
      alert('Вы уже отметили время для этой смены. Изменить нельзя.');
      return;
    }
    setSelectedSchedule(schedule);
    // Предзаполняем плановым временем для удобства
    setActualStart(schedule.start_time.slice(0,5));
    setActualEnd(schedule.end_time.slice(0,5));
    setTimeLogError('');
    setIsTimeLogModalOpen(true);
  };

  const handleSaveTimeLog = async () => {
    if (!selectedSchedule) return;
    if (actualStart >= actualEnd) {
      setTimeLogError('Время окончания должно быть позже начала');
      return;
    }
    setSavingTimeLog(true);
    const newLog = {
      schedule_assignment_id: selectedSchedule.id,
      actual_start: actualStart + ':00',
      actual_end: actualEnd + ':00',
    };
    const { error } = await supabase.from('actual_work_log').insert([newLog]);
    if (!error) {
      await fetchData();
      setIsTimeLogModalOpen(false);
    } else {
      setTimeLogError('Ошибка сохранения: ' + error.message);
    }
    setSavingTimeLog(false);
  };

  // --- Расчёт зарплаты ---
  const calculateSalary = async (period: 'first' | 'second') => {
    setLoadingSalary(true);
    try {
      const nowDate = new Date();
      let startDate: Date, endDate: Date;
      if (period === 'first') {
        // с 7 числа текущего месяца по 21 число
        startDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), 7);
        endDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), 21);
        if (nowDate.getDate() > 21) {
          // Если сегодня позже 21, то показываем текущий период, но данные могут быть неполными
        }
      } else {
        // с 22 числа текущего месяца по 6 число следующего
        startDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), 22);
        endDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 6);
      }
      const startStr = format(startDate, 'yyyy-MM-dd');
      const endStr = format(endDate, 'yyyy-MM-dd');

      // Получаем все назначения за период
      const { data: schedules } = await supabase
        .from('schedule_assignments')
        .select(`
          id, work_date, attraction_id, start_time, end_time,
          attractions ( name, coefficient )
        `)
        .eq('employee_id', profile.id)
        .gte('work_date', startStr)
        .lte('work_date', endStr);

      if (!schedules || schedules.length === 0) {
        setSalaryData({ days: [], total: 0 });
        return;
      }

      // Получаем все логи для этих назначений
      const scheduleIds = schedules.map(s => s.id);
      const { data: logs } = await supabase
        .from('actual_work_log')
        .select('*')
        .in('schedule_assignment_id', scheduleIds);

      const logsMap = new Map<number, ActualWorkLog>();
      logs?.forEach(log => logsMap.set(log.schedule_assignment_id, log));

      const baseRate = profile.base_hourly_rate || 250;
      const daysMap = new Map<string, any>();

      for (const s of schedules) {
        const workDate = s.work_date;
        const log = logsMap.get(s.id);
        if (!log) continue; // не отметил — не оплачиваем

        let actualStartTime = log.actual_start;
        let actualEndTime = log.actual_end;

        // Корректировка начала оплаты: если пришёл до 11:00 -> оплата с 11:00
        // если пришёл с 11:00 до 12:00 -> оплата с 11:00
        // если после 12:00 -> оплата с фактического
        let payStartHour = parseInt(actualStartTime.split(':')[0]);
        let payStartMin = parseInt(actualStartTime.split(':')[1]);
        if (payStartHour < 11 || (payStartHour === 11 && payStartMin === 0)) {
          payStartHour = 11;
          payStartMin = 0;
        } else if (payStartHour < 12) {
          payStartHour = 11;
          payStartMin = 0;
        } // иначе оставляем фактическое

        const payStart = new Date(`${workDate}T${String(payStartHour).padStart(2,'0')}:${String(payStartMin).padStart(2,'0')}:00`);
        const actualEnd = new Date(`${workDate}T${actualEndTime}`);
        if (payStart >= actualEnd) continue; // нет отработанных часов

        const minutesWorked = differenceInMinutes(actualEnd, payStart);
        const hoursWorked = minutesWorked / 60;
        const coefficient = s.attractions?.coefficient || 1.0;
        const earn = hoursWorked * baseRate * coefficient;

        if (!daysMap.has(workDate)) {
          daysMap.set(workDate, { date: workDate, attractions: [], total: 0 });
        }
        const day = daysMap.get(workDate);
        day.attractions.push({
          name: s.attractions?.name || 'Аттракцион',
          hours: hoursWorked,
          rate: baseRate,
          coefficient,
          earn,
        });
        day.total += earn;
      }

      const daysArray = Array.from(daysMap.values()).sort((a,b) => a.date.localeCompare(b.date));
      const totalSalary = daysArray.reduce((sum, day) => sum + day.total, 0);
      setSalaryData({ days: daysArray, total: totalSalary });
    } catch (err) {
      console.error(err);
      setSalaryData(null);
    } finally {
      setLoadingSalary(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'salary') {
      calculateSalary(salaryPeriod);
    }
  }, [activeTab, salaryPeriod]);

  // --- Цель изучения ---
  const handleSaveStudyGoal = async () => {
    if (!selectedAttractionId) { setGoalError('Выберите аттракцион'); return; }
    setSavingGoal(true);
    setGoalError('');
    try {
      if (studyGoal) {
        if (studyGoal.change_count >= 3) throw new Error('Лимит изменений исчерпан');
        const newHistory = [...(studyGoal.change_history || []), studyGoal.attraction_id];
        const { error } = await supabase
          .from('employee_study_goals')
          .update({
            attraction_id: selectedAttractionId,
            change_count: studyGoal.change_count + 1,
            change_history: newHistory,
            updated_at: new Date().toISOString(),
          })
          .eq('id', studyGoal.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('employee_study_goals')
          .insert({
            employee_id: profile.id,
            attraction_id: selectedAttractionId,
            change_count: 1,
            change_history: [],
          });
        if (error) throw error;
      }
      await fetchData();
      alert('Цель изучения сохранена');
    } catch (err: any) {
      setGoalError(err.message);
    } finally {
      setSavingGoal(false);
    }
  };

  // --- Рендеры ---
  const renderMonthDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const days = [];
    for (let i = 0; i < (firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1); i++) {
      days.push(<div key={`empty-${i}`} className="p-3"></div>);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dateObj = new Date(year, month, i);
      const isToday = dateStr === todayStr;
      const shift = shifts.find(s => s.work_date === dateStr);
      const active = isDateActive(dateStr) && !occupiedDates.has(dateStr);
      let bgClass = 'bg-white border-gray-100 shadow-sm';
      if (shift) {
        bgClass = shift.is_full_day ? 'bg-green-50 border-green-300' : 'bg-yellow-50 border-yellow-300';
      } else if (!active) {
        bgClass = 'opacity-40 bg-gray-50 border-gray-100 cursor-not-allowed';
      } else {
        bgClass = 'hover:border-blue-400 hover:bg-blue-50 cursor-pointer bg-white border-gray-100';
      }
      days.push(
        <button
          key={dateStr}
          className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition relative overflow-hidden ${bgClass}`}
          onClick={() => {
            if (shift) openViewModal(shift);
            else if (active) openAddModal(dateStr);
          }}
        >
          <span className={`text-xl font-bold ${isToday ? 'text-blue-600' : 'text-gray-800'} z-10`}>{i}</span>
          <span className="text-[10px] text-gray-500 font-bold uppercase mt-1 z-10">{weekdays[dateObj.getDay()]}</span>
          {shift && <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${shift.is_full_day ? 'bg-green-500' : 'bg-yellow-500'}`} />}
          {shift?.comment && <div className="absolute bottom-1 right-1" title="Есть комментарий"><MessageCircle className="h-3 w-3 text-gray-400" /></div>}
        </button>
      );
    }
    return days;
  };

  const renderShiftsTable = () => {
    if (shiftsForMonth.length === 0) return <div className="text-center py-10 bg-gray-50 rounded-lg"><Calendar className="mx-auto h-10 w-10 mb-2 opacity-50" /><p>Смен в этом месяце пока нет</p></div>;
    return (
      <div className="overflow-x-auto hide-scrollbar">
        <table className="min-w-full divide-y divide-gray-100">
          <thead><tr className="bg-gray-50"><th className="px-4 py-3 text-left text-xs font-semibold">Дата</th><th>Тип</th><th>Время</th><th>Комментарий</th><th className="text-right">Действие</th></tr></thead>
          <tbody>
            {shiftsForMonth.map(shift => {
              const delCheck = canDeleteShift(shift);
              return (
                <tr key={shift.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openViewModal(shift)}>
                  <td className="px-4 py-3">{format(parseISO(shift.work_date), 'dd.MM.yyyy')}</td>
                  <td>{shift.is_full_day ? <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Полная</span> : <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">Неполная</span>}</td>
                  <td>{shift.is_full_day ? 'Весь день' : `${shift.start_time?.slice(0,5)}–${shift.end_time?.slice(0,5)}`}</td>
                  <td>{shift.comment ? <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{shift.comment.slice(0,30)}</span> : '—'}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {delCheck.allowed ? <button onClick={() => handleDeleteShift(shift)} className="text-red-500 p-2"><Trash2 className="h-4 w-4" /></button> : <span className="text-gray-400 text-xs">Блок</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderScheduleTable = () => {
    if (scheduleForMonth.length === 0) return <div className="text-center py-10 bg-gray-50 rounded-lg"><Calendar className="mx-auto h-10 w-10 mb-2 opacity-50" /><p>График от администратора не найден</p></div>;
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100">
          <thead><tr><th>Дата</th><th>Аттракцион</th><th>Плановое время</th><th>Отметка</th><th>Статус</th></tr></thead>
          <tbody>
            {scheduleForMonth.map(s => {
              const log = actualLogs.find(l => l.schedule_assignment_id === s.id);
              const canLog = !log && (parseISO(s.work_date) < startOfDay(new Date()) || (parseISO(s.work_date).getTime() === startOfDay(new Date()).getTime() && new Date().getHours() >= 22));
              return (
                <tr key={s.id} className="border-b">
                  <td className="py-2">{format(parseISO(s.work_date), 'dd.MM.yyyy')}</td>
                  <td>{s.attractions?.name || '—'}</td>
                  <td>{s.start_time.slice(0,5)} – {s.end_time.slice(0,5)}</td>
                  <td>{log ? `${log.actual_start.slice(0,5)}–${log.actual_end.slice(0,5)}` : '—'}</td>
                  <td>
                    {log ? <span className="text-green-600 text-sm"><CheckCircle className="inline h-4 w-4 mr-1" />Отмечено</span> :
                      canLog ? <button onClick={() => openTimeLogModal(s)} className="text-blue-600 text-sm underline">Отметить время</button> :
                      <span className="text-gray-400 text-sm">Недоступно</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderSalaryBlock = () => {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mt-6">
        <h3 className="text-lg font-bold flex items-center gap-2"><DollarSign className="text-green-600" /> Примерный расчёт зарплаты</h3>
        <div className="text-xs text-gray-500 mb-4">*Данные носят ознакомительный характер. Точный расчёт производится бухгалтерией.</div>
        <div className="flex gap-2 mb-4">
          <button onClick={() => setSalaryPeriod('first')} className={`px-3 py-1 rounded ${salaryPeriod === 'first' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>7–21 число</button>
          <button onClick={() => setSalaryPeriod('second')} className={`px-3 py-1 rounded ${salaryPeriod === 'second' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>22–6 число</button>
          <button onClick={() => calculateSalary(salaryPeriod)} className="px-3 py-1 bg-gray-500 text-white rounded">Обновить</button>
        </div>
        {loadingSalary && <Loader2 className="animate-spin mx-auto" />}
        {salaryData && (
          <div>
            <div className="max-h-96 overflow-y-auto">
              {salaryData.days.map(day => (
                <div key={day.date} className="border-b py-2">
                  <div className="font-semibold">{format(parseISO(day.date), 'dd.MM.yyyy')}</div>
                  {day.attractions.map((a: any, idx: number) => (
                    <div key={idx} className="text-sm ml-4">🎢 {a.name}: {a.hours.toFixed(2)} ч × {a.rate}₽ × {a.coefficient} = {Math.round(a.earn)}₽</div>
                  ))}
                  <div className="text-sm font-bold text-right">Итого за день: {Math.round(day.total)}₽</div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xl font-bold text-right">Всего за период: {Math.round(salaryData.total)} ₽</div>
          </div>
        )}
      </div>
    );
  };

  const renderPriorities = () => {
    if (priorities.length === 0) return <div className="text-center py-6 text-gray-400"><Map className="mx-auto h-8 w-8 mb-2" /><p>Приоритеты не заданы</p></div>;
    return (
      <ul className="divide-y">
        {priorities.map(prio => (
          <li key={prio.id} className="py-3 flex justify-between"><span>{prio.attractions?.name || 'Неизвестный'}</span><span className="text-xs bg-gray-100 px-2 py-1 rounded">#{prio.priority_level}</span></li>
        ))}
      </ul>
    );
  };

  const renderStudyGoal = () => {
    const remaining = studyGoal ? 3 - studyGoal.change_count : 3;
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border mt-6">
        <h3 className="text-lg font-bold flex items-center gap-2"><Star className="text-purple-500" /> Цель для изучения</h3>
        <p className="text-xs text-gray-500 mb-2">Осталось изменений: {remaining}</p>
        {goalError && <div className="text-red-600 text-sm mb-2">{goalError}</div>}
        <select value={selectedAttractionId || ''} onChange={e => setSelectedAttractionId(Number(e.target.value))} className="w-full border rounded p-2 mb-2">
          <option value="">-- Выберите --</option>
          {availableAttractions.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button onClick={handleSaveStudyGoal} disabled={savingGoal || (studyGoal && studyGoal.change_count >= 3)} className="w-full bg-blue-600 text-white py-2 rounded">Сохранить цель</button>
      </div>
    );
  };

  const renderSummary = () => (
    <div className="space-y-2">
      <div className="flex justify-between"><span>Всего смен (старых):</span><span className="font-bold">{shiftsForMonth.length}</span></div>
      <div className="flex justify-between"><span>Полных:</span><span>{shiftsForMonth.filter(s => s.is_full_day).length}</span></div>
      <div className="flex justify-between"><span>Неполных:</span><span>{shiftsForMonth.filter(s => !s.is_full_day).length}</span></div>
      <div className="flex justify-between"><span>По графику админа:</span><span>{scheduleForMonth.length}</span></div>
    </div>
  );

  const currentMonthLabel = format(currentDate, 'LLLL yyyy', { locale: ru });

  if (loading) return <div className="flex justify-center p-16"><Loader2 className="animate-spin text-blue-600 h-8 w-8" /></div>;

  return (
    <div className="bg-gray-50 text-gray-900 pb-24 md:pb-0">
      <div className="max-w-7xl mx-auto px-4 pt-6">
        {/* Шапка */}
        <div className="bg-white p-6 rounded-xl shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <div><h2 className="text-2xl font-bold">{greeting || profile.full_name}</h2><p className="text-gray-500 text-sm">{profile.full_name} • Возраст: {profile.age ?? 'Не указан'} • Ставка: {profile.base_hourly_rate}₽/ч</p></div>
          <div className="text-right"><div className="text-2xl font-mono text-blue-600">{now.toLocaleTimeString('ru-RU')}</div><div className="text-gray-500 text-sm">{now.toLocaleDateString('ru-RU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div></div>
        </div>

        {/* Навигация по месяцам */}
        <div className="bg-white p-4 rounded-xl shadow-sm mb-6 flex justify-between items-center">
          <button onClick={() => setCurrentDate(prev => subMonths(prev, 1))}><ChevronLeft /></button>
          <h3 className="text-lg font-semibold">{currentMonthLabel}</h3>
          <button onClick={() => setCurrentDate(prev => addMonths(prev, 1))}><ChevronRight /></button>
        </div>

        {/* Основные блоки */}
        <div className="md:grid md:grid-cols-3 md:gap-6">
          <div className="md:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold flex items-center gap-2"><Calendar className="text-blue-500" /> Даты месяца — {currentMonthLabel}</h3>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 mt-4">{renderMonthDays()}</div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold">Мои смены (самозапись)</h3>
              {renderShiftsTable()}
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold">График от администратора</h3>
              {renderScheduleTable()}
            </div>
            {activeTab === 'salary' && renderSalaryBlock()}
          </div>
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold flex items-center gap-2"><Star className="text-yellow-500" /> Приоритеты аттракционов</h3>
              {renderPriorities()}
            </div>
            {renderStudyGoal()}
            <div className="bg-blue-50 p-6 rounded-xl">
              <h3 className="font-semibold text-blue-800">Сводка — {currentMonthLabel}</h3>
              {renderSummary()}
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm">
              <h3 className="text-lg font-bold flex items-center gap-2"><FileText className="text-purple-500" /> Опрос сотрудника</h3>
              <div className="relative h-[590px] overflow-hidden rounded-xl border"><iframe src="https://docs.google.com/forms/d/e/1FAIpQLSczZC5_pSsbgQrjhKpfis9K0kBD6qLMWa6gWn11brFQ-v-YNQ/viewform?embedded=true" className="absolute top-0 left-0 w-full h-full" frameBorder="0" title="Google Form">Загрузка…</iframe></div>
            </div>
          </div>
        </div>

        <footer className="mt-12 mb-24 md:mb-8 text-center text-xs text-gray-400">
          <p>Hand-coded by <strong><a href="https://vk.com/albars_studio" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-700">AlBars</a></strong> • Vite build: <span className="text-green-500 font-mono font-bold">{ping}</span> ms • Supabase • Host: GitHub Pages</p>
          <p className="italic">Ни один искусственный интеллект не пострадал при создании</p>
        </footer>
      </div>

      {/* Модалки */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl w-full max-w-md relative">
            <button onClick={() => setIsAddModalOpen(false)} className="absolute top-4 right-4"><X /></button>
            <h3 className="text-xl font-bold mb-4">Смена на {formatDateStr(modalDate)}</h3>
            {modalError && <div className="bg-red-50 text-red-700 p-2 rounded mb-2">{modalError}</div>}
            <div className="flex gap-2 mb-4">
              <button onClick={() => setIsFullDayModal(true)} className={`flex-1 py-2 rounded ${isFullDayModal ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>Полная</button>
              <button onClick={() => setIsFullDayModal(false)} className={`flex-1 py-2 rounded ${!isFullDayModal ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>Неполная</button>
            </div>
            {!isFullDayModal && (
              <div className="grid grid-cols-2 gap-2 mb-4">
                <select value={modalStartTime} onChange={e => setModalStartTime(e.target.value)} className="border rounded p-2">{START_TIMES.map(t => <option key={t}>{t}</option>)}</select>
                <select value={modalEndTime} onChange={e => setModalEndTime(e.target.value)} className="border rounded p-2">{END_TIMES.filter(t => t > modalStartTime).map(t => <option key={t}>{t}</option>)}</select>
              </div>
            )}
            <textarea value={modalComment} onChange={e => setModalComment(e.target.value)} rows={3} className="w-full border rounded p-2 mb-4" placeholder="Комментарий (не более 4096 символов)" maxLength={4096} />
            <p className="text-xs text-gray-400 mb-4">Комментарий нельзя будет изменить после создания.</p>
            <button onClick={handleAddShift} disabled={savingShift} className="w-full bg-blue-600 text-white py-2 rounded">Добавить смену</button>
          </div>
        </div>
      )}

      {isViewModalOpen && viewShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl w-full max-w-md relative">
            <button onClick={() => setIsViewModalOpen(false)} className="absolute top-4 right-4"><X /></button>
            <h3 className="text-xl font-bold mb-4">Детали смены</h3>
            <p><strong>Дата:</strong> {format(parseISO(viewShift.work_date), 'dd.MM.yyyy')}</p>
            <p><strong>Тип:</strong> {viewShift.is_full_day ? 'Полная' : 'Неполная'}</p>
            {!viewShift.is_full_day && <p><strong>Время:</strong> {viewShift.start_time?.slice(0,5)} – {viewShift.end_time?.slice(0,5)}</p>}
            <p><strong>Комментарий:</strong> {viewShift.comment || '—'}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setIsViewModalOpen(false)} className="px-4 py-2 bg-gray-200 rounded">Закрыть</button>
              {canDeleteShift(viewShift).allowed && <button onClick={() => handleDeleteShift(viewShift)} className="px-4 py-2 bg-red-600 text-white rounded">Удалить</button>}
            </div>
          </div>
        </div>
      )}

      {isTimeLogModalOpen && selectedSchedule && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-2xl w-full max-w-md relative">
            <button onClick={() => setIsTimeLogModalOpen(false)} className="absolute top-4 right-4"><X /></button>
            <h3 className="text-xl font-bold mb-2">Отметка времени</h3>
            <p className="text-sm mb-4">{format(parseISO(selectedSchedule.work_date), 'dd.MM.yyyy')} – {selectedSchedule.attractions?.name}</p>
            {timeLogError && <div className="bg-red-50 text-red-700 p-2 rounded mb-2">{timeLogError}</div>}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div><label className="block text-xs">Время прихода</label><input type="time" value={actualStart} onChange={e => setActualStart(e.target.value)} className="border rounded w-full p-2" /></div>
              <div><label className="block text-xs">Время ухода</label><input type="time" value={actualEnd} onChange={e => setActualEnd(e.target.value)} className="border rounded w-full p-2" /></div>
            </div>
            <button onClick={handleSaveTimeLog} disabled={savingTimeLog} className="w-full bg-blue-600 text-white py-2 rounded">Сохранить</button>
          </div>
        </div>
      )}

      {/* Мобильное меню */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t flex justify-around h-16 z-40">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center ${activeTab === 'dashboard' ? 'text-blue-600' : 'text-gray-400'}`}><Calendar className="h-5 w-5" /><span className="text-xs">Сводка</span></button>
        <button onClick={() => setActiveTab('shifts')} className={`flex flex-col items-center ${activeTab === 'shifts' ? 'text-blue-600' : 'text-gray-400'}`}><Clock className="h-5 w-5" /><span className="text-xs">Смены</span></button>
        <button onClick={() => setActiveTab('priorities')} className={`flex flex-col items-center ${activeTab === 'priorities' ? 'text-blue-600' : 'text-gray-400'}`}><Star className="h-5 w-5" /><span className="text-xs">Приоритеты</span></button>
        <button onClick={() => setActiveTab('salary')} className={`flex flex-col items-center ${activeTab === 'salary' ? 'text-blue-600' : 'text-gray-400'}`}><DollarSign className="h-5 w-5" /><span className="text-xs">Зарплата</span></button>
        <button onClick={() => setActiveTab('form')} className={`flex flex-col items-center ${activeTab === 'form' ? 'text-blue-600' : 'text-gray-400'}`}><FileText className="h-5 w-5" /><span className="text-xs">Опрос</span></button>
      </nav>

      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
