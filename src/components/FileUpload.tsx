'use client';

import React, { useRef, useState } from 'react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  label?: string;
}

export function FileUpload({ onFileSelect, accept = '.xlsx,.xls', label = 'Drop your file here, or click to browse' }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setFileName(file.name);
      onFileSelect(file);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setFileName(file.name);
      onFileSelect(file);
    }
  };

  return (
    <div 
      className={`w-full p-8 border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
        isDragging ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600'
      }`}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input 
        type="file" 
        className="hidden" 
        ref={fileInputRef} 
        onChange={handleChange} 
        accept={accept}
      />
      <div className="w-12 h-12 mb-4 rounded-full bg-slate-700/50 flex items-center justify-center text-2xl text-slate-400">
        📄
      </div>
      <p className="text-slate-300 font-medium mb-1">
        {fileName ? `Selected: ${fileName}` : label}
      </p>
      {!fileName && (
        <p className="text-slate-500 text-sm">
          Supports {accept.split(',').join(', ')}
        </p>
      )}
    </div>
  );
}
