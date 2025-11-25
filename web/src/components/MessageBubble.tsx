interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
}

const MessageBubble = ({ role, content }: MessageBubbleProps) => {
  const isUser = role === 'user';
  return (
    <div className={`message-row ${isUser ? 'right' : 'left'}`}>
      <div className={`message-bubble ${isUser ? 'user' : 'assistant'}`}>
        <p className="message-role">{isUser ? 'You' : 'Router'}</p>
        <p className="message-content">{content}</p>
      </div>
    </div>
  );
};

export default MessageBubble;
