import React from 'react';
import { Message, Role, Source } from '../types';
import AIAvatar from './AIAvatar';

interface ChatMessageProps {
  message: Message;
  sources?: Source[];
}

// Basic markdown to HTML renderer
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
    const renderContent = () => {
        // Bold: **text** -> <strong>text</strong>
        let html = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Italic: *text* -> <em>text</em>
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // New lines: \n -> <br>
        html = html.replace(/\n/g, '<br />');

        return { __html: html };
    };

    return <div dangerouslySetInnerHTML={renderContent()} />;
};


const ChatMessage: React.FC<ChatMessageProps> = ({ message, sources }) => {
  const isModel = message.role === Role.MODEL;

  // Special handling for the welcome message to apply custom styles
  if (isModel && message.id === 'welcome-0') {
    const [header, ...bodyParts] = message.content.split('\n\n');
    const [line1, line2] = header.trim().split('\n');
    const thirdLine = bodyParts[0];
    const restOfBody = bodyParts.slice(1).join('\n\n');
    
    return (
        <div className={`flex items-start gap-4 my-4`}>
          <AIAvatar />
          <div
            className={`max-w-xl p-4 rounded-2xl text-base leading-relaxed bg-brand-med text-gray-200 rounded-tl-none`}
          >
            <div className="font-extrabold text-2xl md:text-3xl leading-tight">
                <p>{line1}</p>
                <p>{line2}</p>
            </div>
            <div className="mt-4">
                <div className="font-semibold text-base md:text-lg">
                    <MarkdownRenderer content={thirdLine} />
                </div>
                <div className="mt-4">
                    <MarkdownRenderer content={restOfBody} />
                </div>
            </div>
          </div>
        </div>
    );
  }

  return (
    <div className={`flex items-start gap-4 my-4 ${!isModel ? 'justify-end' : ''}`}>
      {isModel && (
        <AIAvatar />
      )}
      <div
        className={`max-w-xl p-4 rounded-2xl text-base leading-relaxed ${
          isModel ? 'bg-brand-med text-gray-200 rounded-tl-none' : 'bg-purple-700 text-white rounded-br-none'
        }`}
      >
        <MarkdownRenderer content={message.content} />
        {isModel && sources && sources.length > 0 && (
          <div className="mt-4 pt-3 border-t border-brand-border">
            <h4 className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Sources</h4>
            <ol className="space-y-1 list-decimal list-inside">
              {sources.map((source, index) => (
                <li key={index} className="text-sm text-pink-400">
                  <a href={source.uri} target="_blank" rel="noopener noreferrer" className="hover:underline" title={source.title}>
                    {source.title || new URL(source.uri).hostname}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;