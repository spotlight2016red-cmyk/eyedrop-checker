import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../config/firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import './FamilyNotification.css';

export function FamilyNotification() {
  const { user } = useAuth();
  const [familyMembers, setFamilyMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [firestoreError, setFirestoreError] = useState(null);

  useEffect(() => {
    if (user) {
      loadFamilyMembers();
    }
  }, [user]);

  const loadFamilyMembers = async () => {
    if (!user) return;
    try {
      const q = query(
        collection(db, 'familyMembers'),
        where('userId', '==', user.uid)
      );
      const snapshot = await getDocs(q);
      const members = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setFamilyMembers(members);
    } catch (err) {
      console.error('家族メンバー読み込みエラー:', err);
      // Firestoreが未作成の場合もエラーを表示しない（表示は継続）
      if (err.code === 'failed-precondition' || err.message?.includes('Firestore')) {
        setFirestoreError('Firestoreが設定されていません。Firebase ConsoleでFirestore Databaseを作成してください。');
      }
    }
  };

  const addFamilyMember = async (e) => {
    e.preventDefault();
    if (!user || !email) return;
    setLoading(true);
    try {
      // メールアドレスからユーザーIDを取得（ユーザーが既に登録済みの場合）
      const auth = getAuth();
      // メールアドレスだけで保存（ログイン時にマッチング）
      await addDoc(collection(db, 'familyMembers'), {
        userId: user.uid,
        email: email.trim(),
        createdAt: new Date()
      });
      setEmail('');
      loadFamilyMembers();
    } catch (err) {
      console.error('家族メンバー追加エラー:', err);
      alert('追加に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const removeFamilyMember = async (id) => {
    if (!confirm('この家族メンバーを削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'familyMembers', id));
      loadFamilyMembers();
    } catch (err) {
      console.error('家族メンバー削除エラー:', err);
      alert('削除に失敗しました');
    }
  };

  if (!user) return null;

  return (
    <div className="family-notification">
      <h3 className="family-title">家族通知設定</h3>
      <p className="family-desc">目薬の使用状況を家族に通知します（家族メンバーも同じアプリにログインしてください）</p>

      {firestoreError && (
        <div className="family-error">
          {firestoreError}
        </div>
      )}

      <form onSubmit={addFamilyMember} className="family-form">
        <input
          type="email"
          placeholder="家族のメールアドレス"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="family-input"
          required
        />
        <button type="submit" disabled={loading} className="family-add-btn">
          {loading ? '追加中...' : '追加'}
        </button>
      </form>

      <div className="family-list">
        {familyMembers.length === 0 ? (
          <p className="family-empty">家族メンバーが登録されていません</p>
        ) : (
          familyMembers.map((member) => (
            <div key={member.id} className="family-item">
              <span>{member.email}</span>
              <button
                onClick={() => removeFamilyMember(member.id)}
                className="family-remove-btn"
              >
                削除
              </button>
            </div>
          ))
        )}
      </div>

      <div className="family-note">
        <p>※ 家族メンバーも同じアプリにログインすると、通知を受け取れます。</p>
        <p>※ カメラで5分間動きが検出されない場合、家族全員に通知が送られます。</p>
        
        <div style={{ marginTop: '16px' }}>
          <button
            onClick={async () => {
              if (!user) return;
              const message = `${new Date().toLocaleDateString('ja-JP')}の目薬が使用されていません（テスト通知）`;
              await notifyFamily(user.uid, message);
              alert('家族にテスト通知を送信しました。家族メンバーがログインしているデバイスで確認してください。');
            }}
            className="family-test-btn"
          >
            テスト通知を送信
          </button>
        </div>
      </div>
    </div>
  );
}

// 家族に通知を送信する関数（エクスポート）
export async function notifyFamily(userId, message) {
  try {
    // 家族メンバーを取得
    const q = query(
      collection(db, 'familyMembers'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    const familyEmails = snapshot.docs.map(doc => doc.data().email);

    // 各家族メンバーのユーザーIDを取得して通知を作成
    const notifications = [];
    for (const email of familyEmails) {
      // メールアドレスでユーザーを検索（usersコレクションに保存されている場合）
      // または、通知をメールアドレスベースで保存
      notifications.push({
        email: email,
        message: message,
        timestamp: new Date(),
        read: false,
        type: 'camera-alert'
      });
    }

    // 通知を保存
    for (const notif of notifications) {
      await addDoc(collection(db, 'notifications'), notif);
    }
  } catch (err) {
    console.error('家族通知送信エラー:', err);
  }
}

