type TelegramSendMessageResponse = {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
};

type TelegramEditMessageResponse = {
  ok: boolean;
  result?: { message_id: number };
  description?: string;
};

export class TelegramClient {
  private readonly token: string;
  private readonly chatIds: string[];

  constructor(opts: { token: string; chatId: string }) {
    this.token = opts.token;
    // Support multiple chat IDs separated by |
    this.chatIds = opts.chatId.split("|").map(s => s.trim()).filter(Boolean);
  }

  private apiUrl(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  // Send to all chat IDs — returns the message_id from the first chat
  async sendMessage(text: string): Promise<number> {
    let firstMessageId = 0;
    for (const chatId of this.chatIds) {
      try {
        const res = await fetch(this.apiUrl("sendMessage"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        });
        const json = (await res.json()) as TelegramSendMessageResponse;
        if (json.ok && json.result) {
          if (firstMessageId === 0) firstMessageId = json.result.message_id;
        } else {
          console.error(`[telegram] sendMessage failed for chat ${chatId}: ${json.description}`);
        }
      } catch (e) {
        console.error(`[telegram] sendMessage error for chat ${chatId}:`, e);
      }
    }
    if (firstMessageId === 0) {
      throw new Error("Telegram sendMessage failed for all chat IDs");
    }
    return firstMessageId;
  }

  // Edit only the primary (first) chat's message
  async editMessage(messageId: number, newText: string): Promise<void> {
    const chatId = this.chatIds[0];
    if (!chatId) return;
    const res = await fetch(this.apiUrl("editMessageText"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const json = (await res.json()) as TelegramEditMessageResponse;
    if (!json.ok) {
      // Don't throw — edit failures are non-critical
      console.error(`[telegram] editMessage failed: ${json.description}`);
    }
  }

  async deleteMessage(messageId: number): Promise<void> {
    const chatId = this.chatIds[0];
    if (!chatId) return;
    await fetch(this.apiUrl("deleteMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
      }),
    });
  }
}
