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
  private readonly chatId: string;

  constructor(opts: { token: string; chatId: string }) {
    this.token = opts.token;
    this.chatId = opts.chatId;
  }

  private apiUrl(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async sendMessage(text: string): Promise<number> {
    const res = await fetch(this.apiUrl("sendMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const json = (await res.json()) as TelegramSendMessageResponse;
    if (!json.ok || !json.result) {
      throw new Error(
        `Telegram sendMessage failed: ${json.description ?? "unknown error"}`,
      );
    }
    return json.result.message_id;
  }

  async editMessage(messageId: number, newText: string): Promise<void> {
    const res = await fetch(this.apiUrl("editMessageText"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        message_id: messageId,
        text: newText,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const json = (await res.json()) as TelegramEditMessageResponse;
    if (!json.ok) {
      throw new Error(
        `Telegram editMessageText failed: ${json.description ?? "unknown error"}`,
      );
    }
  }

  async deleteMessage(messageId: number): Promise<void> {
    await fetch(this.apiUrl("deleteMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        message_id: messageId,
      }),
    });
    // Ignore errors — message may already be deleted or too old
  }
}

