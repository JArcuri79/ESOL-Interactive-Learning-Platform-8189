import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

function QRCodeGenerator({ value, size = 200 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current && value) {
      // Clear any previous QR code
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Log the QR code value for debugging
      console.log('Generating QR code for:', value);
      
      // Generate new QR code with optimized settings for mobile scanning
      QRCode.toCanvas(
        canvasRef.current,
        value,
        {
          width: size,
          margin: 1, // Reduced margin for cleaner look
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          },
          errorCorrectionLevel: 'H', // High error correction for better scanning
          scale: 8, // Increase scale for better mobile scanning
          rendererOpts: {
            quality: 1.0 // Maximum quality
          }
        },
        (error) => {
          if (error) {
            console.error('QR Code generation error:', error);
          } else {
            console.log('QR Code generated successfully');
          }
        }
      );
    }
  }, [value, size]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 inline-block">
      <canvas ref={canvasRef} className="rounded" width={size} height={size} />
      <div className="text-xs text-green-600 mt-2 text-center font-medium">
        Scan with your phone camera
      </div>
      <div className="text-xs text-gray-500 mt-1 text-center">
        {value ? value.substring(0, 30) + (value.length > 30 ? '...' : '') : 'Loading link...'}
      </div>
    </div>
  );
}

export default QRCodeGenerator;