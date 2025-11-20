import React, { useState } from 'react';

interface HeaderProps {
    name: string | null;
    userType: 'user' | 'admin' | null;
    onLogout: () => void;
}


const Header: React.FC<HeaderProps> = ({ name, userType, onLogout }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="bg-brand-med-dark/50 backdrop-blur-sm p-4 border-b border-brand-border shadow-lg sticky top-0 z-10">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center">
          {/* The Logo */}
          <div className="w-48">
            <img src="https://boboz.co.ke/wp-content/uploads/2025/11/amicus_1_logo.png" alt="Amicus Pro Logo" className="w-full h-auto" />
          </div>
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center space-x-6">
            <a href="#" className="text-sm font-medium text-pink-400" aria-current="page">Ask a Lawyer</a>
            <a href="#" className="text-sm font-medium text-gray-300 hover:text-pink-400 transition-colors duration-200">Find a Lawyer</a>
            <a href="#" className="text-sm font-medium text-gray-300 hover:text-pink-400 transition-colors duration-200">Be a Lawyer</a>
             {name && (
                 <button
                    onClick={onLogout}
                    className="bg-red-600/80 text-white font-semibold rounded-lg px-3 py-1.5 text-xs transition-all duration-200 ease-in-out enabled:hover:bg-red-500 enabled:active:scale-95"
                >
                    Logout
                </button>
             )}
        </nav>

        {/* Mobile Menu Button */}
        <div className="md:hidden">
            <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="text-gray-300 hover:text-white focus:outline-none focus:text-white"
                aria-controls="mobile-menu"
                aria-expanded={isMenuOpen}
                aria-label="Toggle menu"
            >
                <span className="sr-only">Open main menu</span>
                {isMenuOpen ? (
                <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
                ) : (
                <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                )}
            </button>
        </div>
      </div>

      {/* Mobile Menu */}
      <div className={`${isMenuOpen ? 'block' : 'hidden'} md:hidden transition-all duration-300`} id="mobile-menu">
        <div className="pt-2 pb-3 space-y-1 sm:px-3">
          <a href="#" className="text-pink-400 block px-3 py-2 rounded-md text-base font-medium" aria-current="page">Ask a Lawyer</a>
          <a href="#" className="text-gray-300 hover:text-white hover:bg-brand-med/50 block px-3 py-2 rounded-md text-base font-medium">Find a Lawyer</a>
          <a href="#" className="text-gray-300 hover:text-white hover:bg-brand-med/50 block px-3 py-2 rounded-md text-base font-medium">Be a Lawyer</a>
           {name && (
                <div className="border-t border-brand-border pt-4 mt-4">
                     <button
                        onClick={onLogout}
                        className="w-full text-left bg-red-600/80 text-white font-semibold rounded-lg px-3 py-2 text-base transition-all duration-200 ease-in-out enabled:hover:bg-red-500 enabled:active:scale-95"
                    >
                        Logout
                    </button>
                </div>
             )}
        </div>
      </div>
    </header>
  );
};

export default Header;