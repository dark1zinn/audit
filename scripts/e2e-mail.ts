/**
 * In-process SMTP capture for `bun run e2e`. The mail-enabled server sends through it; the
 * Playwright spec reads what arrived from `messagesUrl`. Plain SMTP only (no STARTTLS, no AUTH),
 * which is all nodemailer needs for a `smtp://127.0.0.1:<port>` URL.
 */

export type MailMessage = { readonly to: string; readonly subject: string; readonly text: string }

export type MailCapture = {
  readonly smtpUrl: string
  readonly messagesUrl: string
  readonly stop: () => void
}

type Session = {
  mailFrom?: string
  recipients: string[]
  data: string[] | null
  buffer: string
}

const parseMessage = (raw: string, recipients: readonly string[]): MailMessage => {
  const headerEnd = raw.indexOf("\r\n\r\n")
  const headers = headerEnd === -1 ? raw : raw.slice(0, headerEnd)
  const body = headerEnd === -1 ? "" : raw.slice(headerEnd + 4)
  const subject = /^Subject: (.*)$/m.exec(headers)?.[1] ?? ""
  return { to: recipients[0] ?? "", subject, text: body }
}

export const startMailCapture = (): MailCapture => {
  const messages: MailMessage[] = []
  const reply = (socket: { write: (data: string) => number }, line: string) => {
    socket.write(`${line}\r\n`)
  }

  const smtp = Bun.listen<Session>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { recipients: [], data: null, buffer: "" }
        reply(socket, "220 e2e.local ESMTP capture")
      },
      data(socket, chunk) {
        const session = socket.data
        session.buffer += Buffer.from(chunk).toString("utf8")
        let end = session.buffer.indexOf("\r\n")
        while (end !== -1) {
          const line = session.buffer.slice(0, end)
          session.buffer = session.buffer.slice(end + 2)
          if (session.data !== null) {
            if (line === ".") {
              messages.push(parseMessage(session.data.join("\r\n"), session.recipients))
              session.data = null
              session.recipients = []
              reply(socket, "250 queued")
            } else {
              // Dot-stuffing: a leading "." on a data line was doubled by the sender.
              session.data.push(line.startsWith("..") ? line.slice(1) : line)
            }
          } else {
            const command = line.toUpperCase()
            if (command.startsWith("EHLO")) {
              reply(socket, "250 e2e.local")
            } else if (command.startsWith("HELO")) {
              reply(socket, "250 e2e.local")
            } else if (command.startsWith("MAIL FROM:")) {
              session.mailFrom = line.slice(10).trim()
              reply(socket, "250 ok")
            } else if (command.startsWith("RCPT TO:")) {
              session.recipients.push(line.slice(8).trim().replace(/^<|>$/g, ""))
              reply(socket, "250 ok")
            } else if (command === "DATA") {
              session.data = []
              reply(socket, "354 end with <CRLF>.<CRLF>")
            } else if (command === "RSET") {
              session.recipients = []
              session.data = null
              reply(socket, "250 ok")
            } else if (command === "NOOP") {
              reply(socket, "250 ok")
            } else if (command === "QUIT") {
              reply(socket, "221 bye")
              socket.end()
            } else {
              reply(socket, "502 command not implemented")
            }
          }
          end = session.buffer.indexOf("\r\n")
        }
      },
      close() {},
      error() {},
    },
  })

  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/messages") return Response.json(messages)
      return new Response("not found", { status: 404 })
    },
  })

  return {
    smtpUrl: `smtp://127.0.0.1:${smtp.port}`,
    messagesUrl: `http://127.0.0.1:${http.port}/messages`,
    stop: () => {
      smtp.stop(true)
      http.stop(true)
    },
  }
}
