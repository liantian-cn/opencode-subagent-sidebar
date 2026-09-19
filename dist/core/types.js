// 自动生成：npm run build；请修改 src 中的源码。
export class MissingSession extends Error {
  constructor(sessionID) {
    super(`会话不存在：${sessionID}`);
    this.sessionID = sessionID;
  }
}
