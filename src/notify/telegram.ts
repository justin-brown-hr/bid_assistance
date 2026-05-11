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

type TelegramUpdate = {
  update_id: number;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

type TelegramGetUpdatesResponse = {
  ok: boolean;
  result?: TelegramUpdate[];
};

export class TelegramClient {
  private readonly token: string;
  private readonly chatIds: string[];
  private updateOffset = 0;

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

  // Send message with an inline "📋 Description" button
  // callbackData is the key used to look up the description later (e.g. project id)
  async sendMessageWithButton(text: string, callbackData: string): Promise<number> {
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
            reply_markup: {
              inline_keyboard: [[
                { text: "📋 Description", callback_data: `show:${callbackData}` },
              ]],
            },
          }),
        });
        const json = (await res.json()) as TelegramSendMessageResponse;
        if (json.ok && json.result) {
          if (firstMessageId === 0) firstMessageId = json.result.message_id;
        } else {
          console.error(`[telegram] sendMessageWithButton failed for chat ${chatId}: ${json.description}`);
        }
      } catch (e) {
        console.error(`[telegram] sendMessageWithButton error for chat ${chatId}:`, e);
      }
    }
    if (firstMessageId === 0) {
      throw new Error("Telegram sendMessageWithButton failed for all chat IDs");
    }
    return firstMessageId;
  }

  // Edit the inline keyboard of a message (used to swap Description ↔ Hide button)
  async editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<void> {
    await fetch(this.apiUrl("editMessageReplyMarkup"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    }).catch((e) => console.error("[telegram] editMessageReplyMarkup error:", e));
  }

  // Answer a callback query (removes the loading spinner on the button)
  async answerCallbackQuery(callbackQueryId: string): Promise<void> {
    await fetch(this.apiUrl("answerCallbackQuery"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    }).catch(() => {});
  }

  // Send a message to a specific chat with HTML parse mode (used for description replies)
  async sendToChat(chatId: number, text: string): Promise<void> {
    await this.sendToChatWithId(chatId, text);
  }

  // Same as sendToChat but returns the sent message_id (for toggle/delete)
  async sendToChatWithId(chatId: number, text: string): Promise<number | null> {
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
      if (json.ok && json.result) return json.result.message_id;
      console.error("[telegram] sendToChatWithId failed:", json.description);
      return null;
    } catch (e) {
      console.error("[telegram] sendToChatWithId error:", e);
      return null;
    }
  }

  // Long-poll for updates and call onCallback when a button is tapped
  // onCallback receives: callback_data, chatId, queryId, original notification messageId
  startPolling(onCallback: (data: string, chatId: number, queryId: string, notifMsgId: number) => void): void {
    const poll = async () => {
      try {
        const res = await fetch(this.apiUrl("getUpdates"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            offset: this.updateOffset,
            timeout: 30,
            allowed_updates: ["callback_query"],
          }),
        });
        const json = (await res.json()) as TelegramGetUpdatesResponse;
        if (json.ok && json.result) {
          for (const update of json.result) {
            this.updateOffset = update.update_id + 1;
            const cq = update.callback_query;
            if (cq?.data && cq.message?.chat.id) {
              onCallback(cq.data, cq.message.chat.id, cq.id, cq.message.message_id);
            }
          }
        }
      } catch {
        // Network hiccup — wait a bit before retrying
        await new Promise(r => setTimeout(r, 5000));
      }
      void poll();
    };
    void poll();
    console.log("[telegram] Callback polling started.");
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

  async deleteMessage(messageId: number, chatId?: number): Promise<void> {
    const id = chatId ?? this.chatIds[0];
    if (!id) return;
    await fetch(this.apiUrl("deleteMessage"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: id,
        message_id: messageId,
      }),
    });
  }
}
