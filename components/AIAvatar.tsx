import React from 'react';

const AIAvatar: React.FC = () => {
  return (
    <div className="flex-shrink-0 w-10 h-10 bg-brand-med rounded-full flex items-center justify-center border-2 border-brand-border">
      <img 
        src="https://boboz.co.ke/wp-content/uploads/2025/11/matt_icon.png" 
        alt="Matt AI Avatar" 
        className="w-full h-full object-contain rounded-full" 
        aria-label="AI assistant avatar"
      />
    </div>
  );
};

export default AIAvatar;