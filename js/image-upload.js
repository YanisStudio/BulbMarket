/**
 * 後台上傳圖片共用工具（商品管理、布告欄管理、分類管理）
 *
 * 1. compress()：上傳前在瀏覽器端縮圖、壓縮。手機照片、螢幕截圖原檔常常好幾 MB，
 *    整張傳上去會拖慢每個訪客的載入速度。沒有透明背景的 PNG（例如螢幕截圖）也轉成 JPEG，
 *    通常可以小好幾倍。任何一步出錯都直接回傳原始檔案，不會擋住儲存。
 * 2. METADATA：上傳時一併設定瀏覽器快取。每次上傳的檔名都帶時間戳記、內容不會再變，
 *    可以放心讓瀏覽器快取一年；否則 Firebase Storage 預設不快取，每次進站都重新下載。
 */
(function() {
    const CACHE_CONTROL = 'public, max-age=31536000, immutable';

    // 抽樣檢查圖片是否真的有透明像素（全部不透明的 PNG 轉 JPEG 不會有差別）
    function hasTransparency(ctx, width, height) {
        try {
            const data = ctx.getImageData(0, 0, width, height).data;
            const step = Math.max(4, Math.floor(data.length / 4 / 20000) * 4);
            for (let i = 3; i < data.length; i += step) {
                if (data[i] < 250) return true;
            }
            return false;
        } catch (error) {
            return true;
        }
    }

    /**
     * @param {File} file
     * @param {{maxDimension?: number, quality?: number}} options
     * @returns {Promise<File>}
     */
    async function compress(file, options) {
        const maxDimension = (options && options.maxDimension) || 1200;
        const quality = (options && options.quality) || 0.82;

        try {
            if (!file || !file.type || !file.type.startsWith('image/')) return file;
            // 動畫 GIF、向量 SVG 畫到 canvas 會失去動畫／變點陣，維持原檔
            if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

            // imageOrientation: 'from-image' 套用照片的 EXIF 方向，避免手機照片壓縮後變橫的
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
            const width = Math.round(bitmap.width * scale);
            const height = Math.round(bitmap.height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();

            const keepPng = file.type === 'image/png' && hasTransparency(ctx, width, height);
            let outputType = keepPng ? 'image/png' : 'image/jpeg';
            if (outputType === 'image/jpeg') {
                // JPEG 沒有透明，先墊白底再畫一次，避免半透明邊緣變黑
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, width, height);
            }

            const blob = await new Promise(function(resolve) {
                canvas.toBlob(resolve, outputType, outputType === 'image/jpeg' ? quality : undefined);
            });
            if (!blob) return file;

            // 沒有縮小尺寸、壓完反而比原檔大，就用原檔
            if (scale === 1 && blob.size >= file.size) return file;

            const ext = outputType === 'image/png' ? 'png' : 'jpg';
            const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
            const result = new File([blob], baseName + '.' + ext, { type: outputType });
            console.log('圖片壓縮: ' + file.name + ' ' + Math.round(file.size / 1024) + 'KB -> ' +
                result.name + ' ' + Math.round(result.size / 1024) + 'KB');
            return result;
        } catch (error) {
            console.warn('圖片壓縮失敗，改用原始檔案上傳:', error);
            return file;
        }
    }

    // uploadBytes 的第三個參數：設定內容類型與瀏覽器快取
    function metadataFor(file) {
        return {
            contentType: file.type || 'application/octet-stream',
            cacheControl: CACHE_CONTROL
        };
    }

    window.ImageUpload = {
        CACHE_CONTROL: CACHE_CONTROL,
        compress: compress,
        metadataFor: metadataFor
    };
})();
