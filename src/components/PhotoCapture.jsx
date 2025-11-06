import { useState, useRef, useEffect } from 'react';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, addDoc, query, where, getDocs, orderBy, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { storage, db } from '../config/firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import './PhotoCapture.css';

export function PhotoCapture() {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedPhotos, setUploadedPhotos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState(null); // メイン写真を選び直し中のドキュメントID
  const [tempSelectedIndex, setTempSelectedIndex] = useState(null); // 選択候補のインデックス
  const [currentFacing, setCurrentFacing] = useState('environment'); // 'user' | 'environment'
  
  // 自撮りモード用の状態
  const [isSelfieMode, setIsSelfieMode] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [capturedPhotos, setCapturedPhotos] = useState([]); // 連続撮影した写真
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null); // 選択した写真のインデックス
  const playbackIntervalRef = useRef(null);
  const isSwitchingRef = useRef(false); // カメラ切替処理中フラグ

  // 指定パターンのカメラdeviceIdを推定
  const pickCameraByLabel = async (pattern) => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      const preferred = videos.find(d => pattern.test(d.label || ''));
      return preferred?.deviceId || videos[0]?.deviceId || null;
    } catch {
      return null;
    }
  };

  // カメラの前面/背面を切り替え（撮影モードは変更しない）
  const switchCamera = async () => {
    // 既に処理中の場合は無視
    if (isSwitchingRef.current) {
      console.log('[PhotoCapture] カメラ切替処理中、スキップ');
      return;
    }
    
    isSwitchingRef.current = true;
    try {
      const next = currentFacing === 'user' ? 'environment' : 'user';
      console.log('[PhotoCapture] カメラ切替開始:', currentFacing, '→', next, '（現在のモード:', isSelfieMode ? '自撮り' : '通常', '）');
      
      // カメラの向きだけを変更し、撮影モード（isSelfieMode）は変更しない
      // nullを渡すことで、isSelfieModeの現在の値を維持
      await startCameraWithFacing(next, null);
    } finally {
      // 処理完了後にフラグをリセット（少し遅延させて確実に）
      setTimeout(() => {
        isSwitchingRef.current = false;
      }, 500);
    }
  };

  // カメラを開始（向きを直接指定可能）
  const startCameraWithFacing = async (facing = null, selfieMode = null) => {
    console.log('[PhotoCapture] startCameraWithFacing呼び出し:', { facing, selfieMode, currentIsSelfieMode: isSelfieMode });
    
    // 既存ストリームを停止してから開始
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    // facingが指定されている場合はそれを使う、なければselfieModeまたはisSelfieModeから推測
    const wantFront = facing ? (facing === 'user') : (selfieMode !== null ? selfieMode : !!isSelfieMode);
    const targetFacing = facing || (wantFront ? 'user' : 'environment');
    console.log('[PhotoCapture] カメラ設定:', { wantFront, targetFacing, facing, selfieMode });
    
    setCurrentFacing(targetFacing);
    // selfieModeが指定されている場合は状態も更新
    if (selfieMode !== null) {
      setIsSelfieMode(selfieMode);
      console.log('[PhotoCapture] isSelfieModeを更新:', selfieMode);
    }
    
    const tryConstraintsInOrder = async () => {
      const trials = [];
      if (wantFront) {
        trials.push({ video: { facingMode: { exact: 'user' } } });
        trials.push({ video: { facingMode: 'user' } });
      } else {
        trials.push({ video: { facingMode: { exact: 'environment' } } });
        trials.push({ video: { facingMode: 'environment' } });
      }

      // デバイス列挙（ラベルが取れない環境ではnullの可能性あり）
      const frontId = await pickCameraByLabel(/front|前面|内側|self|face/i);
      const backId = await pickCameraByLabel(/back|rear|背面|外側|world/i);
      console.log('[PhotoCapture] デバイスID:', { frontId, backId, wantFront });
      
      if (wantFront && frontId) {
        trials.push({ video: { deviceId: { exact: frontId } } });
      }
      if (!wantFront && backId) {
        trials.push({ video: { deviceId: { exact: backId } } });
      }

      // 最後のフォールバック（どれでも）は削除 - 指定した向きのカメラのみを許可
      // trials.push({ video: true });

      let lastError = null;
      for (let i = 0; i < trials.length; i++) {
        const c = trials[i];
        try {
          console.log(`[PhotoCapture] 制約 ${i + 1}/${trials.length} を試行:`, c);
          const s = await navigator.mediaDevices.getUserMedia(c);
          const track = s.getVideoTracks()[0];
          const settings = track.getSettings();
          console.log('[PhotoCapture] カメラ取得成功:', settings);
          return s;
        } catch (e) {
          console.warn(`[PhotoCapture] 制約 ${i + 1}/${trials.length} 失敗:`, e.message);
          lastError = e;
        }
      }
      throw lastError || new Error('getUserMedia failed');
    };

    try {
      const mediaStream = await tryConstraintsInOrder();
      setStream(mediaStream);
      
      // video要素がレンダリングされるまで待つ（最大1秒）
      let retries = 0;
      const maxRetries = 10;
      while (!videoRef.current && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      if (!videoRef.current) {
        console.error('[PhotoCapture] video要素が見つかりません（タイムアウト）');
        mediaStream.getTracks().forEach(track => track.stop());
        setStream(null);
        alert('カメラの初期化に失敗しました。ページをリロードして再度お試しください。');
        return;
      }
      
      console.log('[PhotoCapture] video要素を確認:', !!videoRef.current);
      
      // 再生を試みる関数（統一）
      const attemptPlay = async () => {
        if (!videoRef.current) return false;
        
        try {
          await videoRef.current.play();
          console.log('[PhotoCapture] 動画再生開始成功');
          return true;
        } catch (playError) {
          console.error('[PhotoCapture] 動画再生エラー:', playError);
          return false;
        }
      };
      
      videoRef.current.srcObject = mediaStream;
      
      // video要素のイベントを監視
      videoRef.current.onloadedmetadata = () => {
        console.log('[PhotoCapture] メタデータ読み込み完了');
        // メタデータ読み込み後、再生を開始
        if (videoRef.current && videoRef.current.paused) {
          console.log('[PhotoCapture] メタデータ読み込み後、再生を開始');
          attemptPlay();
        }
      };
      
      videoRef.current.oncanplay = () => {
        console.log('[PhotoCapture] 動画再生可能');
        // 再生を再試行（まだ停止している場合）
        if (videoRef.current && videoRef.current.paused) {
          console.log('[PhotoCapture] oncanplay後の再生を試行');
          attemptPlay();
        }
      };
      
      videoRef.current.onplay = () => {
        try {
          const track = mediaStream.getVideoTracks?.()[0];
          const settings = track?.getSettings?.() || {};
          console.log('[PhotoCapture] 動画再生開始', settings);
        } catch {
          console.log('[PhotoCapture] 動画再生開始');
        }
      };
      
      videoRef.current.onerror = (e) => {
        const error = videoRef.current?.error;
        const errorCode = error?.code;
        const errorMessage = error?.message || 'エラーが発生しました';
        
        // 一時的なエラー（ネットワークエラーなど）は静かに処理
        // MEDIA_ERR_SRC_NOT_SUPPORTED (4) や MEDIA_ERR_NETWORK (2) は再試行可能
        if (errorCode === 2 || errorCode === 4) {
          console.warn('[PhotoCapture] 動画読み込みエラー（再試行可能）:', errorCode, errorMessage);
          // 自動再試行はしない（ユーザーが手動で再試行する）
        } else {
          console.error('[PhotoCapture] video要素エラー:', errorCode, errorMessage, e);
          // 重大なエラーのみアラートを表示
          if (errorCode === 1) { // MEDIA_ERR_ABORTED
            console.warn('[PhotoCapture] 動画読み込みが中断されました（再試行してください）');
          } else {
            alert(`動画の再生に失敗しました: ${errorMessage}`);
          }
        }
      };
      
    } catch (err) {
      console.error('[PhotoCapture] カメラアクセスエラー:', err);
      alert('カメラへのアクセスが許可されていません。ブラウザの設定からカメラへのアクセスを許可してください。');
    }
  };

  // カメラを開始（既存コードとの互換性のため）
  const startCamera = () => startCameraWithFacing(null);

  // カメラを停止
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setPhotoUrl(null);
  };

  // 写真を撮影（1枚）
  const capturePhoto = () => {
    console.log('[PhotoCapture] capturePhoto呼び出し（通常撮影）', { isSelfieMode, currentFacing });
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    // 一時的に画像を表示
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    setPhotoUrl(dataUrl);
  };

  // 自撮りモード：カウントダウン開始
  const startSelfieCapture = () => {
    if (!stream) {
      alert('まずカメラを開始してください');
      return;
    }
    // 自撮りモードでない場合、または背面カメラの場合は通常撮影にフォールバック
    if (!isSelfieMode || currentFacing === 'environment') {
      console.log('[PhotoCapture] 自撮りモードではないため、通常撮影にフォールバック', { isSelfieMode, currentFacing });
      capturePhoto();
      return;
    }
    console.log('[PhotoCapture] 自撮りモードでカウントダウン開始', { isSelfieMode, currentFacing });
    setIsCapturing(true);
    setCapturedPhotos([]);
    setCurrentPhotoIndex(0);
    setSelectedPhotoIndex(null); // 選択をリセット
    
    // カウントダウン（3, 2, 1）
    let count = 3;
    setCountdown(count);
    
    const countdownInterval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
      } else {
        clearInterval(countdownInterval);
        setCountdown(null);
        // カウントダウン終了後、連続撮影開始
        startContinuousCapture();
      }
    }, 1000);
  };

  // 連続撮影（3秒間で10枚）
  const startContinuousCapture = () => {
    const photos = [];
    const captureCount = 10; // 3秒間で10枚
    const interval = 300; // 300msごと
    
    let captured = 0;
    const captureInterval = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        clearInterval(captureInterval);
        setIsCapturing(false);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      photos.push(dataUrl);
      captured++;

      if (captured >= captureCount) {
        clearInterval(captureInterval);
        setIsCapturing(false);
        setCapturedPhotos(photos);
        // 自動的に再生開始
        playPhotos();
      }
    }, interval);
  };

  // 撮影した写真を再生（スライドショー）
  const playPhotos = () => {
    if (capturedPhotos.length === 0) return;
    
    setIsPlaying(true);
    setCurrentPhotoIndex(0);
    
    let index = 0;
    playbackIntervalRef.current = setInterval(() => {
      index++;
      if (index >= capturedPhotos.length) {
        // 最後まで再生したら停止
        stopPlayback();
      } else {
        setCurrentPhotoIndex(index);
      }
    }, 200); // 200msごとに次の写真に切り替え（約2秒で全10枚）
  };

  // 再生停止
  const stopPlayback = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    setIsPlaying(false);
  };

  // 再生リセット
  const resetPlayback = () => {
    stopPlayback();
    setCurrentPhotoIndex(0);
  };
  
  // 前の写真に移動
  const goToPreviousPhoto = () => {
    stopPlayback(); // 再生中なら停止
    if (currentPhotoIndex > 0) {
      setCurrentPhotoIndex(currentPhotoIndex - 1);
    } else {
      setCurrentPhotoIndex(capturedPhotos.length - 1); // 最初なら最後に
    }
  };
  
  // 次の写真に移動
  const goToNextPhoto = () => {
    stopPlayback(); // 再生中なら停止
    if (currentPhotoIndex < capturedPhotos.length - 1) {
      setCurrentPhotoIndex(currentPhotoIndex + 1);
    } else {
      setCurrentPhotoIndex(0); // 最後なら最初に
    }
  };

  // OKボタン：アップロード
  const confirmAndUpload = async () => {
    if (capturedPhotos.length === 0) return;
    
    setUploading(true);
    try {
      // すべての写真をアップロード
      const timestamp = Date.now();
      const uploadPromises = capturedPhotos.map(async (photoDataUrl, index) => {
        // DataURLをBlobに変換
        const response = await fetch(photoDataUrl);
        const blob = await response.blob();
        
        // Firebase Storageにアップロード
        const fileName = `eyedrop-action/${user.uid}/${timestamp}-${index}.jpg`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, blob);
        return await getDownloadURL(storageRef);
      });

      const photoUrls = await Promise.all(uploadPromises);

      // Firestoreに保存（すべての写真URLを含む）
      await addDoc(collection(db, 'eyedropPhotos'), {
        userId: user.uid,
        email: user.email,
        photoUrls: photoUrls, // 複数の写真URL
        photoCount: photoUrls.length,
        selectedPhotoIndex: selectedPhotoIndex !== null ? selectedPhotoIndex : 0, // 選択した写真のインデックス（未選択の場合は0）
        timestamp: new Date(),
        type: 'correct-action', // 正しい動作の写真
        mode: 'selfie' // 自撮りモード
      });

      alert('写真をアップロードしました！\n正しい動作として保存されました。');
      // 状態をリセットしてカメラビューに戻る
      setCapturedPhotos([]);
      setCurrentPhotoIndex(0);
      setSelectedPhotoIndex(null);
      setCountdown(null);
      setIsCapturing(false);
      setIsPlaying(false);
      loadUploadedPhotos();
      
      // カメラストリームをビデオ要素に再設定
      setTimeout(() => {
        const video = videoRef.current;
        if (video) {
          const currentStream = video.srcObject;
          if (currentStream && currentStream.active) {
            console.log('[PhotoCapture] カメラストリームはアクティブ、再生を強制');
            // ストリームは存在するが、再生されていない可能性があるので再生を強制
            video.play().catch(err => {
              console.warn('[PhotoCapture] ビデオ再生エラー:', err);
            });
          } else if (stream && stream.active) {
            console.log('[PhotoCapture] カメラストリームをビデオ要素に再設定');
            video.srcObject = stream;
            // 再生を強制
            video.play().catch(err => {
              console.warn('[PhotoCapture] ビデオ再生エラー:', err);
            });
          } else {
            console.log('[PhotoCapture] カメラストリームが停止されているため、再起動します');
            // カメラを再起動（現在のモードを維持）
            startCameraWithFacing(currentFacing, isSelfieMode);
          }
        }
      }, 100);
    } catch (err) {
      console.error('[PhotoCapture] アップロードエラー:', err);
      console.error('[PhotoCapture] エラー詳細:', err.code, err.message);
      
      let errorMessage = `アップロードに失敗しました: ${err.message || err.code || '不明なエラー'}`;
      
      // CORSエラーの場合、より詳細なメッセージを表示
      if (err.code === 'storage/unauthorized' || err.message?.includes('CORS') || err.message?.includes('permission')) {
        errorMessage = 'アップロードに失敗しました。\n\nFirebase Storageのセキュリティルールが設定されていない可能性があります。\n\nFirebase ConsoleでStorageのセキュリティルールを設定してください。';
      }
      
      alert(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  // NGボタン：再撮影
  const rejectAndRetry = () => {
    setCapturedPhotos([]);
    setCurrentPhotoIndex(0);
    setSelectedPhotoIndex(null);
    stopPlayback();
  };
  
  // この写真を選択
  const selectCurrentPhoto = () => {
    setSelectedPhotoIndex(currentPhotoIndex);
    alert(`写真 ${currentPhotoIndex + 1} を選択しました。\nアップロード時にこの写真がメイン表示として使用されます。`);
  };

  // 写真をアップロード
  const uploadPhoto = async () => {
    if (!user || !photoUrl) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setUploading(true);
    try {
      // CanvasからBlobを取得
      canvas.toBlob(async (blob) => {
        if (!blob) {
          setUploading(false);
          return;
        }

        try {
          // Firebase Storageにアップロード
          const timestamp = Date.now();
          const fileName = `eyedrop-action/${user.uid}/${timestamp}.jpg`;
          const storageRef = ref(storage, fileName);
          await uploadBytes(storageRef, blob);
          const downloadURL = await getDownloadURL(storageRef);

          // Firestoreに保存
          await addDoc(collection(db, 'eyedropPhotos'), {
            userId: user.uid,
            email: user.email,
            photoUrl: downloadURL,
            timestamp: new Date(),
            type: 'correct-action' // 正しい動作の写真
          });

          alert('写真をアップロードしました！\n正しい動作として保存されました。');
          // 状態をリセットしてカメラビューに戻る
          setPhotoUrl(null);
          loadUploadedPhotos();
          
          // カメラストリームが継続しているか確認
          if (!stream && videoRef.current) {
            console.log('[PhotoCapture] カメラストリームが停止されているため、再起動します');
            // カメラを再起動（現在のモードを維持）
            startCameraWithFacing(currentFacing, isSelfieMode);
          }
        } catch (err) {
          console.error('[PhotoCapture] アップロードエラー:', err);
          console.error('[PhotoCapture] エラー詳細:', err.code, err.message);
          
          let errorMessage = `アップロードに失敗しました: ${err.message || err.code || '不明なエラー'}`;
          
          // CORSエラーの場合、より詳細なメッセージを表示
          if (err.code === 'storage/unauthorized' || err.message?.includes('CORS') || err.message?.includes('permission')) {
            errorMessage = 'アップロードに失敗しました。\n\nFirebase Storageのセキュリティルールが設定されていない可能性があります。\n\nFirebase ConsoleでStorageのセキュリティルールを設定してください。';
          }
          
          alert(errorMessage);
        } finally {
          setUploading(false);
        }
      }, 'image/jpeg', 0.8);
    } catch (err) {
      console.error('写真処理エラー:', err);
      alert(`写真の処理に失敗しました: ${err.message}`);
      setUploading(false);
    }
  };

  // アップロード済みの写真からメイン写真を選び直す
  const updateSelectedPhoto = async (photoId, index) => {
    try {
      await updateDoc(doc(db, 'eyedropPhotos', photoId), { selectedPhotoIndex: index });
      setEditingPhotoId(null);
      setTempSelectedIndex(null);
      await loadUploadedPhotos();
      alert('メイン写真を更新しました');
    } catch (err) {
      console.error('[PhotoCapture] メイン写真更新エラー:', err);
      alert('更新に失敗しました');
    }
  };

  // アップロード済み写真を削除
  const deletePhoto = async (photo) => {
    if (!confirm('この写真を削除しますか？\n\n削除した写真は復元できません。')) {
      return;
    }

    try {
      // Firebase Storageから画像を削除
      const urlsToDelete = photo.photoUrls || (photo.photoUrl ? [photo.photoUrl] : []);
      
      await Promise.all(
        urlsToDelete.map(async (url) => {
          try {
            // URLからストレージパスを抽出
            // https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=...
            const urlObj = new URL(url);
            const pathMatch = urlObj.pathname.match(/\/o\/(.+)$/);
            if (pathMatch) {
              const decodedPath = decodeURIComponent(pathMatch[1]);
              const storageRef = ref(storage, decodedPath);
              await deleteObject(storageRef);
              console.log('[PhotoCapture] Storageから削除:', decodedPath);
            }
          } catch (err) {
            console.warn('[PhotoCapture] Storage削除エラー（続行）:', err);
            // 一部の画像が削除できなくても続行
          }
        })
      );

      // Firestoreからドキュメントを削除
      await deleteDoc(doc(db, 'eyedropPhotos', photo.id));
      
      alert('写真を削除しました');
      await loadUploadedPhotos();
    } catch (err) {
      console.error('[PhotoCapture] 削除エラー:', err);
      alert(`削除に失敗しました: ${err.message || '不明なエラー'}`);
    }
  };

  // アップロード済み写真を読み込み
  const loadUploadedPhotos = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'eyedropPhotos'),
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(q);
      const photos = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUploadedPhotos(photos);
    } catch (err) {
      // 権限エラーの場合は警告を表示（初回のみ）
      const isPermissionError = err.code === 'permission-denied' || 
                                 err.code === 'permissions-error' ||
                                 err.message?.includes('permissions') ||
                                 err.message?.includes('Missing or insufficient permissions');
      
      if (isPermissionError) {
        console.warn('[PhotoCapture] Firestoreの読み取り権限がありません。Firestoreのセキュリティルールを確認してください。', err);
        // エラーを静かに処理（ユーザーに通知しない）
        setUploadedPhotos([]);
      } else {
        console.error('[PhotoCapture] 写真読み込みエラー:', err);
        // その他のエラーも静かに処理
        setUploadedPhotos([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // コンポーネントマウント時にアップロード済み写真を読み込み
  useEffect(() => {
    if (user) {
      loadUploadedPhotos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // アップロード後にビデオ要素を再設定（真っ黒画面を防ぐ）
  useEffect(() => {
    // 撮影が完了し、カメラビューが表示されるべき状態のとき
    if (stream && capturedPhotos.length === 0 && !photoUrl && videoRef.current) {
      const video = videoRef.current;
      // srcObjectが設定されていない、または異なる場合は再設定
      if (!video.srcObject || video.srcObject !== stream) {
        console.log('[PhotoCapture] ビデオ要素にストリームを再設定');
        video.srcObject = stream;
        // 再生を試みる
        video.play().catch(err => {
          console.warn('[PhotoCapture] ビデオ再生エラー（再設定後）:', err);
        });
      } else if (video.paused) {
        // srcObjectは設定されているが、再生されていない場合は再生
        console.log('[PhotoCapture] ビデオを再生（一時停止中）');
        video.play().catch(err => {
          console.warn('[PhotoCapture] ビデオ再生エラー:', err);
        });
      }
    }
  }, [stream, capturedPhotos.length, photoUrl]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      stopCamera();
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, []);

  if (!user) return null;

  return (
    <div className="photo-capture">
      <h3 className="photo-title">正しい動作の写真を送る</h3>
      <p className="photo-desc">
        目薬をさす正しい動作を写真で送ってください。<br />
        将来的にAIがこの動作を学習して、正確に検知できるようになります。
      </p>

      {/* モード選択 */}
      {!stream && (
        <div className="photo-mode-selector">
          <button
            onClick={async () => {
              console.log('[PhotoCapture] 自撮りモードボタンクリック');
              // 自撮りモード（前面カメラ）で起動、状態も同時に更新
              await startCameraWithFacing('user', true);
            }}
            className="photo-btn photo-btn-selfie"
          >
            自撮りモード（カウントダウン撮影）
          </button>
          <button
            onClick={async () => {
              console.log('[PhotoCapture] 通常モードボタンクリック');
              // 通常モード（背面カメラ）で起動、状態も同時に更新
              await startCameraWithFacing('environment', false);
            }}
            className="photo-btn"
          >
            通常モード（1枚撮影）
          </button>
        </div>
      )}

      {stream && (
        <div className="photo-camera-view">
          <div className="photo-video-container">
            {/* カウントダウン表示 */}
            {countdown !== null && (
              <div className="photo-countdown">
                <div className="photo-countdown-number">{countdown}</div>
              </div>
            )}
            
            {/* 撮影中表示 */}
            {isCapturing && countdown === null && (
              <div className="photo-capturing">
                <div className="photo-capturing-text">撮影中...</div>
              </div>
            )}

            {/* 再生画面 */}
            {capturedPhotos.length > 0 && !isCapturing && (
              <div className="photo-playback">
                {/* 画像ボックス（矢印を画像の上に重ねる） */}
                <div className="photo-image-box">
                  <button
                    onClick={goToPreviousPhoto}
                    className="photo-btn-nav photo-btn-nav-prev"
                    aria-label="前の写真"
                  >
                    ◀
                  </button>
                  <img 
                    src={capturedPhotos[currentPhotoIndex]} 
                    alt={`撮影した写真 ${currentPhotoIndex + 1}/${capturedPhotos.length}`}
                    className="photo-playback-image"
                  />
                  <button
                    onClick={goToNextPhoto}
                    className="photo-btn-nav photo-btn-nav-next"
                    aria-label="次の写真"
                  >
                    ▶
                  </button>
                </div>
                <div className="photo-playback-info">
                  {currentPhotoIndex + 1} / {capturedPhotos.length}
                </div>
                <div style={{ fontSize: '12px', color: '#fff', textAlign: 'center', marginBottom: '8px', padding: '0 16px', lineHeight: '1.5' }}>
                  📌 矢印で写真を確認 → 気に入った写真を選択 → OKでアップロード
                </div>
                <div className="photo-playback-controls">
                  {!isPlaying ? (
                    <>
                      <button onClick={playPhotos} className="photo-btn-play">
                        ▶️ 再生
                      </button>
                      <button onClick={resetPlayback} className="photo-btn-reset">
                        🔄 最初から
                      </button>
                    </>
                  ) : (
                    <button onClick={stopPlayback} className="photo-btn-stop-playback">
                      ⏸️ 停止
                    </button>
                  )}
                </div>
                <div className="photo-confirm-actions">
                  <button
                    onClick={selectCurrentPhoto}
                    className="photo-btn-select"
                    disabled={uploading}
                    style={{
                      background: selectedPhotoIndex === currentPhotoIndex 
                        ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                        : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      opacity: uploading ? 0.5 : 1
                    }}
                  >
                    {selectedPhotoIndex === currentPhotoIndex ? '✓ 選択済み' : '📌 この写真を選択'}
                  </button>
                  <button
                    onClick={rejectAndRetry}
                    className="photo-btn-reject"
                    disabled={uploading}
                  >
                    ❌ やり直す
                  </button>
                  <button
                    onClick={confirmAndUpload}
                    className="photo-btn-confirm"
                    disabled={uploading}
                  >
                    {uploading ? 'アップロード中...' : '✅ OK'}
                  </button>
                </div>
              </div>
            )}

            {/* 通常モード：1枚撮影のプレビュー */}
            {isSelfieMode === false && photoUrl && capturedPhotos.length === 0 && (
              <div className="photo-preview">
                <img src={photoUrl} alt="撮影した写真" />
                <div style={{ fontSize: '12px', color: '#fff', textAlign: 'center', marginBottom: '12px', padding: '0 16px', lineHeight: '1.5' }}>
                  📌 写真を確認して、アップロードまたはやり直しを選択してください
                </div>
                <div className="photo-preview-actions">
                  <button
                    onClick={() => setPhotoUrl(null)}
                    className="photo-btn-cancel"
                  >
                    やり直す
                  </button>
                  <button
                    onClick={uploadPhoto}
                    disabled={uploading}
                    className="photo-btn-upload"
                  >
                    {uploading ? 'アップロード中...' : '✓ アップロード'}
                  </button>
                </div>
              </div>
            )}

            {/* ビデオ表示（常に表示、オーバーレイでカウントダウンや撮影中を表示） */}
            {capturedPhotos.length === 0 && !photoUrl && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="photo-video"
                onClick={async () => {
                  // 動画要素をクリックしたときに再生を開始（PWAモードで自動再生が制限される場合に対応）
                  if (videoRef.current && videoRef.current.paused) {
                    try {
                      await videoRef.current.play();
                      console.log('[PhotoCapture] クリック時の再生成功');
                    } catch (err) {
                      console.error('[PhotoCapture] クリック時の再生エラー:', err);
                    }
                  }
                }}
                style={{ cursor: 'pointer' }}
              />
            )}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
          
          <div className="photo-controls">
            {/* 自撮りモード：カウントダウン撮影ボタン（自撮りモードの場合のみ） */}
            {isSelfieMode && capturedPhotos.length === 0 && countdown === null && !isCapturing && (
              <button onClick={startSelfieCapture} className="photo-btn-capture-selfie" disabled={isCapturing}>
                撮影
              </button>
            )}
            
            {/* 通常モード：1枚撮影ボタン（通常モードの場合） */}
            {!isSelfieMode && !photoUrl && capturedPhotos.length === 0 && (
              <button onClick={capturePhoto} className="photo-btn-capture">
                撮影
              </button>
            )}
            
            <button onClick={switchCamera} className="photo-btn-stop" style={{ borderColor: '#3b82f6', color: '#3b82f6' }}>
              カメラ切替
            </button>
            <button onClick={stopCamera} className="photo-btn-stop">
              カメラを停止
            </button>
          </div>
        </div>
      )}

      {/* アップロード済み写真一覧 */}
      {uploadedPhotos.length > 0 && (
        <div className="photo-list">
          <h4 className="photo-list-title">アップロード済み写真</h4>
          {loading ? (
            <p>読み込み中...</p>
          ) : (
            <div className="photo-grid">
              {uploadedPhotos.map((photo) => {
                // 自撮りモード（複数写真）と通常モード（1枚）の両方に対応
                // 選択した写真がある場合はそれを表示、なければ最初の写真を表示
                const selectedIndex = photo.selectedPhotoIndex !== undefined ? photo.selectedPhotoIndex : 0;
                const imageUrl = photo.photoUrls && photo.photoUrls.length > 0 
                  ? photo.photoUrls[selectedIndex] // 自撮りモード：選択した写真（または最初の写真）を表示
                  : photo.photoUrl; // 通常モード：1枚の写真
                
                console.log('[PhotoCapture] 写真データ:', {
                  id: photo.id,
                  photoUrl: photo.photoUrl,
                  photoUrls: photo.photoUrls,
                  imageUrl: imageUrl,
                  mode: photo.mode
                });
                
                return (
                  <div key={photo.id} className="photo-item">
                    {imageUrl ? (
                      <img 
                        src={imageUrl} 
                        alt="アップロード済み写真" 
                        onError={(e) => {
                          console.error('[PhotoCapture] 画像読み込みエラー:', {
                            imageUrl,
                            photoId: photo.id,
                            photoData: photo
                          });
                          e.target.style.display = 'none';
                        }}
                        onLoad={() => {
                          console.log('[PhotoCapture] 画像読み込み成功:', imageUrl);
                        }}
                      />
                    ) : (
                      <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                        画像がありません
                      </div>
                    )}
                    <p className="photo-date">
                      {photo.timestamp?.toDate?.().toLocaleString('ja-JP') || 
                       (photo.timestamp instanceof Date ? photo.timestamp.toLocaleString('ja-JP') : '日時不明')}
                    </p>
                    <button
                      onClick={() => deletePhoto(photo)}
                      className="photo-btn-reject"
                      style={{
                        width: '100%',
                        marginTop: '8px',
                        fontSize: '12px',
                        padding: '6px 12px'
                      }}
                    >
                      🗑️ 削除
                    </button>
                    {photo.photoUrls && photo.photoUrls.length > 1 && (
                      <div style={{ marginTop: '8px' }}>
                        <button
                          onClick={() => {
                            setEditingPhotoId(photo.id);
                            setTempSelectedIndex(photo.selectedPhotoIndex ?? 0);
                          }}
                          className="photo-btn-select"
                          style={{
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            color: 'white',
                            width: '100%'
                          }}
                        >
                          別の写真を選ぶ（{photo.photoUrls.length}枚）
                        </button>
                        {editingPhotoId === photo.id && (
                          <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '8px' }}>
                            {photo.photoUrls.map((thumb, idx) => (
                              <div key={idx} style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setTempSelectedIndex(idx)}>
                                <img src={thumb} alt={`候補 ${idx + 1}`} style={{ width: '100%', height: '64px', objectFit: 'cover', borderRadius: '6px', border: (tempSelectedIndex ?? 0) === idx ? '3px solid #10b981' : '2px solid #e5e7eb' }} />
                              </div>
                            ))}
                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', marginTop: '4px' }}>
                              <button
                                onClick={() => updateSelectedPhoto(photo.id, tempSelectedIndex ?? 0)}
                                className="photo-btn-confirm"
                                style={{ flex: 1 }}
                              >
                                この写真をメインにする
                              </button>
                              <button
                                onClick={() => { setEditingPhotoId(null); setTempSelectedIndex(null); }}
                                className="photo-btn-reject"
                                style={{ flex: 1 }}
                              >
                                キャンセル
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

