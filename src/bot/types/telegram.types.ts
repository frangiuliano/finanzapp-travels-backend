export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from: { id: number; first_name?: string; username?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data: string;
    message: { chat: { id: number }; message_id: number };
  };
}
