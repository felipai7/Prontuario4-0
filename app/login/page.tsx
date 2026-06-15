import LoginForm from '@/components/auth/LoginForm'

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏥</div>
          <h1 className="text-2xl font-bold text-slate-800">Sistema UTI</h1>
          <p className="text-slate-500 text-sm mt-1">Balanços e Evoluções</p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
