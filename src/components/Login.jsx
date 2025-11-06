import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import './Login.css';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignup) {
        await signup(email, password);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err.message || 'エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 className="login-title">目薬チェック</h1>
        <p className="login-subtitle">{isSignup ? '新規登録' : 'ログイン'}</p>
        
        {error && <div className="login-error">{error}</div>}
        
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="login-input"
          />
          <input
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="login-input"
          />
          <button type="submit" disabled={loading} className="login-button">
            {loading ? '処理中...' : (isSignup ? '登録' : 'ログイン')}
          </button>
        </form>
        
        <button
          onClick={() => {
            setIsSignup(!isSignup);
            setError('');
          }}
          className="login-switch"
        >
          {isSignup ? 'ログインはこちら' : '新規登録はこちら'}
        </button>
      </div>
    </div>
  );
}


