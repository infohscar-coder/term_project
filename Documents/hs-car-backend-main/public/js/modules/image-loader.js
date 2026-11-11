/**
 * Image loading utility with CORS fallback and error handling
 * Handles Firebase Storage images gracefully when CORS is not configured
 */

export async function loadImageWithFallback(storagePath, fallbackDataUrl = null) {
  try {
    // Try direct load first
    const img = new Image();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Image load timeout'));
      }, 5000);
      
      img.onload = () => {
        clearTimeout(timeout);
        resolve(img.src);
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        if (fallbackDataUrl) {
          resolve(fallbackDataUrl);
        } else {
          reject(new Error(`Failed to load image: ${storagePath}`));
        }
      };
      
      img.src = storagePath;
    });
  } catch (error) {
    console.warn(`Image loading failed for ${storagePath}:`, error);
    if (fallbackDataUrl) {
      return fallbackDataUrl;
    }
    throw error;
  }
}

/**
 * Generic placeholder image (1x1 transparent PNG)
 */
export const PLACEHOLDER_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==';

/**
 * Set image with CORS fallback
 * Usage: setImageWithFallback(imageElement, firebaseStorageUrl, optionalFallback);
 */
export function setImageWithFallback(imgElement, storagePath, fallbackUrl = PLACEHOLDER_IMAGE) {
  imgElement.style.opacity = '0.5';
  
  loadImageWithFallback(storagePath, fallbackUrl)
    .then(url => {
      imgElement.src = url;
      imgElement.style.opacity = '1';
    })
    .catch(error => {
      console.warn(`Setting fallback for ${storagePath}:`, error);
      imgElement.src = fallbackUrl || PLACEHOLDER_IMAGE;
      imgElement.style.opacity = '1';
      imgElement.style.backgroundColor = '#e5e7eb'; // Light gray background
    });
}
