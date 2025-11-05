import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../config/firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import './FamilyNotification.css';

export function FamilyNotification() {
  const { user } = useAuth();
  const [familyMembers, setFamilyMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

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
    }
  };

  const addFamilyMember = async (e) => {
    e.preventDefault();
    if (!user || !email) return;
    setLoading(true);
    try {
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

  const sendNotificationToFamily = async (message) => {
    if (!user) return;
    try {
      // 家族メンバーに通知を送信するCloud Functionを呼び出す
      // または、Firestoreに通知データを書き込んで、各デバイスが監視する
      const notificationData = {
        userId: user.uid,
        message,
        timestamp: new Date(),
        read: false
      };
      await addDoc(collection(db, 'notifications'), notificationData);
    } catch (err) {
      console.error('通知送信エラー:', err);
    }
  };

  if (!user) return null;

  return (
    <div className="family-notification">
      <h3 className="family-title">家族通知設定</h3>
      <p className="family-desc">目薬の使用状況を家族に通知します</p>

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
        <p>※ 家族メンバーには、目薬の使用が検出されない場合に通知が送られます。</p>
      </div>
    </div>
  );
}

// 家族に通知を送信する関数（エクスポート）
export async function notifyFamily(userId, message) {
  try {
    const notificationData = {
      userId,
      message,
      timestamp: new Date(),
      read: false
    };
    await addDoc(collection(db, 'notifications'), notificationData);
  } catch (err) {
    console.error('家族通知送信エラー:', err);
  }
}

