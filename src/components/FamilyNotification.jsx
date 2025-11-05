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
    setFirestoreError(null);
    
    // タイムアウト設定（10秒）
    const timeout = setTimeout(() => {
      setLoading(false);
      setFirestoreError('追加に時間がかかっています。Firestoreが正しく設定されているか確認してください。');
    }, 10000);
    
    try {
      // メールアドレスからユーザーIDを取得（ユーザーが既に登録済みの場合）
      const auth = getAuth();
      // メールアドレスだけで保存（ログイン時にマッチング）
      await addDoc(collection(db, 'familyMembers'), {
        userId: user.uid,
        email: email.trim(),
        createdAt: new Date()
      });
      clearTimeout(timeout);
      setEmail('');
      loadFamilyMembers();
    } catch (err) {
      clearTimeout(timeout);
      console.error('家族メンバー追加エラー:', err);
      if (err.code === 'permission-denied') {
        setFirestoreError('Firestoreのセキュリティルールが設定されていません。Firebase Consoleでルールを確認してください。');
      } else if (err.code === 'unavailable' || err.message?.includes('Failed to get document')) {
        setFirestoreError('Firestoreが利用できません。Firebase ConsoleでFirestore Databaseを作成してください。');
      } else {
        setFirestoreError(`追加に失敗しました: ${err.message || err.code || '不明なエラー'}`);
      }
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
          <div style={{ marginTop: '8px', fontSize: '12px' }}>
            <p>解決方法:</p>
            <ol style={{ margin: '4px 0', paddingLeft: '20px' }}>
              <li>Firebase Consoleを開く</li>
              <li>「Firestore Database」→「ルール」タブ</li>
              <li>以下のルールをコピー＆ペーストして「公開」をクリック</li>
            </ol>
            <pre style={{ background: '#f3f4f6', padding: '8px', borderRadius: '4px', fontSize: '11px', overflow: 'auto' }}>
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /familyMembers/{document} {
      allow read, write: if request.auth != null;
    }
    match /notifications/{document} {
      allow read, write: if request.auth != null;
    }
  }
}`}
            </pre>
          </div>
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
              console.log('[FamilyNotification] テスト通知送信開始:', { userId: user.uid, email: user.email });
              try {
                await notifyFamily(user.uid, message, user.email);
                console.log('[FamilyNotification] テスト通知送信完了');
                alert(`家族にテスト通知を送信しました。\n\n送信先: 本人と登録されている家族メンバー\n本人と家族メンバーがログインしているデバイスで確認してください。`);
              } catch (err) {
                console.error('[FamilyNotification] テスト通知送信エラー:', err);
                alert(`通知送信に失敗しました: ${err.message || err.code || '不明なエラー'}`);
              }
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
export async function notifyFamily(userId, message, userEmail = null) {
  try {
    // 家族メンバーを取得
    const q = query(
      collection(db, 'familyMembers'),
      where('userId', '==', userId)
    );
    const snapshot = await getDocs(q);
    const familyEmails = snapshot.docs.map(doc => doc.data().email);
    console.log('[notifyFamily] 家族メンバー:', familyEmails);

    // 通知を送る対象のメールアドレスリスト（本人 + 家族メンバー）
    const targetEmails = [];
    
    // 本人のメールアドレスを追加（指定されている場合）
    if (userEmail) {
      targetEmails.push(userEmail);
      console.log('[notifyFamily] 本人にも通知を送信:', userEmail);
    }
    
    // 家族メンバーのメールアドレスを追加（重複を避ける）
    for (const email of familyEmails) {
      if (!targetEmails.includes(email)) {
        targetEmails.push(email);
      }
    }

    if (targetEmails.length === 0) {
      console.warn('[notifyFamily] 通知を送る対象がありません');
      return;
    }

    // 各メンバーに通知を作成
    const notifications = [];
    for (const email of targetEmails) {
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
      const docRef = await addDoc(collection(db, 'notifications'), notif);
      console.log('[notifyFamily] 通知を保存:', { id: docRef.id, email: notif.email });
    }
    
    console.log('[notifyFamily] すべての通知を送信完了:', targetEmails.length, '件');
  } catch (err) {
    console.error('家族通知送信エラー:', err);
    throw err;
  }
}

