import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';
import { Plus, Trash2, Loader2, X } from 'lucide-react';

interface EmployeesListProps {
  isSuperAdmin: boolean;
}

interface EmployeeWithAuth extends UserProfile {
  phone_number?: string;
  telegram?: string;
  max?: string;
  vk?: string;
  last_sign_in_at?: string | null;
}

export function EmployeesList({ isSuperAdmin }: EmployeesListProps) {
  const [employees, setEmployees] = useState<EmployeeWithAuth[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    age: '',
    phone_number: '',
    telegram: '',
    max: '',
    vk: '',
    email: '',
    password: '',
    access_level: '3',
  });
  const [formError, setFormError] = useState('');

  const fetchEmployees = async () => {
    setLoading(true);
    // Получаем всех сотрудников из employees
    const { data: empData, error: empError } = await supabase
      .from('employees')
      .select('id, full_name, age, phone_number, telegram, max, vk, auth_uid, access_level');
    if (empError) {
      console.error(empError);
      setLoading(false);
      return;
    }

    // Получаем last_sign_in_at из auth.users (через RPC или прямой запрос)
    // В Supabase нельзя просто так SELECT из auth.users через клиент. Нужно использовать функцию.
    // Создадим временное решение: будем хранить last_sign_in_at в отдельной таблице или запрашивать через RPC.
    // Упростим: пока не будем выводить время, а сделаем позже. Сначала покажем сотрудников без last_sign_in_at.

    setEmployees(empData as EmployeeWithAuth[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleDelete = async (id: number, authUid: string) => {
    if (!confirm('Удалить сотрудника? Он потеряет доступ к системе.')) return;
    // Удаляем из employees
    const { error: empError } = await supabase.from('employees').delete().eq('id', id);
    if (empError) {
      alert('Ошибка удаления из employees');
      return;
    }
    // Удаляем пользователя из auth (только для суперадмина, нужен специальный ключ)
    // В Supabase удаление пользователя через клиент требует прав администратора.
    // Проще: удаляем только из employees, а из auth оставляем (или удаляем вручную в панели Supabase).
    // Для простоты оставим как есть.
    fetchEmployees();
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    // 1. Создаём пользователя в auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: formData.email,
      password: formData.password,
    });
    if (authError) {
      setFormError('Ошибка создания пользователя: ' + authError.message);
      return;
    }
    const authUid = authData.user?.id;
    if (!authUid) {
      setFormError('Не удалось получить ID пользователя');
      return;
    }
    // 2. Добавляем запись в employees
    const { error: insertError } = await supabase.from('employees').insert({
      full_name: formData.full_name,
      age: parseInt(formData.age) || null,
      phone_number: formData.phone_number || null,
      telegram: formData.telegram || null,
      max: formData.max || null,
      vk: formData.vk || null,
      auth_uid: authUid,
      access_level: parseInt(formData.access_level),
    });
    if (insertError) {
      setFormError('Ошибка добавления в employees: ' + insertError.message);
      return;
    }
    setShowAddForm(false);
    setFormData({ full_name: '', age: '', phone_number: '', telegram: '', max: '', vk: '', email: '', password: '', access_level: '3' });
    fetchEmployees();
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Сотрудники</h2>
        {isSuperAdmin && (
          <button onClick={() => setShowAddForm(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm flex items-center gap-1">
            <Plus className="h-4 w-4" /> Добавить
          </button>
        )}
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Новый сотрудник</h3>
              <button onClick={() => setShowAddForm(false)}><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-3">
              <input type="text" placeholder="ФИО" className="w-full border p-2 rounded" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} required />
              <input type="number" placeholder="Возраст" className="w-full border p-2 rounded" value={formData.age} onChange={e => setFormData({...formData, age: e.target.value})} />
              <input type="text" placeholder="Телефон" className="w-full border p-2 rounded" value={formData.phone_number} onChange={e => setFormData({...formData, phone_number: e.target.value})} />
              <input type="text" placeholder="Telegram" className="w-full border p-2 rounded" value={formData.telegram} onChange={e => setFormData({...formData, telegram: e.target.value})} />
              <input type="text" placeholder="Max (соцсеть)" className="w-full border p-2 rounded" value={formData.max} onChange={e => setFormData({...formData, max: e.target.value})} />
              <input type="text" placeholder="VK" className="w-full border p-2 rounded" value={formData.vk} onChange={e => setFormData({...formData, vk: e.target.value})} />
              <input type="email" placeholder="Email (для входа)" className="w-full border p-2 rounded" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} required />
              <input type="password" placeholder="Пароль" className="w-full border p-2 rounded" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} required />
              <select className="w-full border p-2 rounded" value={formData.access_level} onChange={e => setFormData({...formData, access_level: e.target.value})}>
                <option value="3">Сотрудник</option>
                <option value="2">Администратор</option>
                <option value="1">Супер-администратор</option>
              </select>
              {formError && <div className="text-red-600 text-sm">{formError}</div>}
              <button type="submit" className="w-full bg-green-600 text-white py-2 rounded">Сохранить</button>
            </form>
          </div>
        </div>
      )}

      <div className="overflow-x-auto border rounded-xl">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold">ФИО</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Возраст</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Телефон</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Telegram</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Max</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">VK</th>
              <th className="px-4 py-3 text-left text-xs font-semibold">Последний вход</th>
              {isSuperAdmin && <th className="px-4 py-3 text-right">Действия</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.id}>
                <td className="px-4 py-2 text-sm">{emp.full_name}</td>
                <td className="px-4 py-2 text-sm">{emp.age}</td>
                <td className="px-4 py-2 text-sm">{emp.phone_number || '—'}</td>
                <td className="px-4 py-2 text-sm">{emp.telegram || '—'}</td>
                <td className="px-4 py-2 text-sm">{emp.max || '—'}</td>
                <td className="px-4 py-2 text-sm">{emp.vk || '—'}</td>
                <td className="px-4 py-2 text-sm">— (пока не реализовано)</td>
                {isSuperAdmin && (
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => handleDelete(emp.id, emp.auth_uid)} className="text-red-600 hover:text-red-800">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
