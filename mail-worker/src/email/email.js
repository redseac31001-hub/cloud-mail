import PostalMime from 'postal-mime';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import settingService from '../service/setting-service';
import attService from '../service/att-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import { emailConst, isDel, roleConst, settingConst } from '../const/entity-const';
import emailUtils from '../utils/email-utils';
import roleService from '../service/role-service';
import verifyUtils from '../utils/verify-utils';
import userService from '../service/user-service';
import telegramService from '../service/telegram-service';

export async function email(message, env, ctx) {

	try {

		const {
			receive,
			tgChatId,
			tgBotStatus,
			forwardStatus: globalForwardStatus,
			forwardEmail: globalForwardEmail,
			ruleEmail,
			ruleType,
			r2Domain,
			noRecipient
		} = await settingService.query({ env });

		if (receive === settingConst.receive.CLOSE) {
			message.setReject('Service suspended');
			return;
		}


		const reader = message.raw.getReader();
		let content = '';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			content += new TextDecoder().decode(value);
		}

		const email = await PostalMime.parse(content);

		const account = await accountService.selectByEmailIncludeDel({ env: env }, message.to);

		if (!account && noRecipient === settingConst.noRecipient.CLOSE) {
			message.setReject('Recipient not found');
			return;
		}

		let userRow = {}

		if (account) {
			 userRow = await userService.selectByIdIncludeDel({ env: env }, account.userId);
		}

		if (account && userRow.email !== env.admin) {

			let { banEmail, banEmailType, availDomain } = await roleService.selectByUserId({ env: env }, account.userId);

			if (!roleService.hasAvailDomainPerm(availDomain, message.to)) {
				message.setReject('Mailbox disabled');
				return;
			}

			banEmail = banEmail.split(',').filter(item => item !== '');


			if (banEmail.includes('*')) {

				if (!banEmailHandler(banEmailType, message, email)) return;

			}

			for (const item of banEmail) {

				if (verifyUtils.isDomain(item)) {

					const banDomain = item.toLowerCase();
					const receiveDomain = emailUtils.getDomain(email.from.address.toLowerCase());

					if (banDomain === receiveDomain) {

						if (!banEmailHandler(banEmailType, message, email)) return;

					}

				} else {

					if (item.toLowerCase() === email.from.address.toLowerCase()) {

						if (!banEmailHandler(banEmailType, message, email)) return;

					}

				}

			}

		}


		if (!email.to) {
			email.to = [{ address: message.to, name: emailUtils.getName(message.to)}]
		}

		const toName = email.to.find(item => item.address === message.to)?.name || '';

		const params = {
			toEmail: message.to,
			toName: toName,
			sendEmail: email.from.address,
			name: email.from.name || emailUtils.getName(email.from.address),
			subject: email.subject,
			content: email.html,
			text: email.text,
			cc: email.cc ? JSON.stringify(email.cc) : '[]',
			bcc: email.bcc ? JSON.stringify(email.bcc) : '[]',
			recipient: JSON.stringify(email.to),
			inReplyTo: email.inReplyTo,
			relation: email.references,
			messageId: email.messageId,
			userId: account ? account.userId : 0,
			accountId: account ? account.accountId : 0,
			isDel: isDel.DELETE,
			status: emailConst.status.SAVING
		};

		const attachments = [];
		const cidAttachments = [];

		for (let item of email.attachments) {
			let attachment = { ...item };
			attachment.key = constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(attachment.content) + fileUtils.getExtFileName(item.filename);
			attachment.size = item.content.length ?? item.content.byteLength;
			attachments.push(attachment);
			if (attachment.contentId) {
				cidAttachments.push(attachment);
			}
		}

		let emailRow = await emailService.receive({ env }, params, cidAttachments, r2Domain);

		attachments.forEach(attachment => {
			attachment.emailId = emailRow.emailId;
			attachment.userId = emailRow.userId;
			attachment.accountId = emailRow.accountId;
		});

		try {
			if (attachments.length > 0) {
				await attService.addAtt({ env }, attachments);
			}
		} catch (e) {
			console.error(e);
		}

		emailRow = await emailService.completeReceive({ env }, account ? emailConst.status.RECEIVE : emailConst.status.NOONE, emailRow.emailId);


		if (ruleType === settingConst.ruleType.RULE) {

			const recipient = String(message.to || '').trim().toLowerCase();
			const emails = String(ruleEmail || '')
				.split(',')
				.map(item => item.trim().toLowerCase())
				.filter(Boolean);

			if (!emails.includes(recipient)) {
				return;
			}

		}

		//转发到TG
		if (tgBotStatus === settingConst.tgBotStatus.OPEN && tgChatId) {
			try {
				await telegramService.sendEmailToBot({ env }, emailRow)
			} catch (e) {
				console.error(`转发 TG 失败：`, e);
			}
		}

		//转发到其他邮箱
		if (globalForwardStatus === settingConst.forwardStatus.OPEN) {

			let targets = '';

			if (
				account &&
				account.isDel === isDel.NORMAL &&
				account.forwardStatus === settingConst.forwardStatus.OPEN &&
				account.forwardEmail
			) {
				targets = account.forwardEmail;
			} else {
				targets = globalForwardEmail || '';
			}

			const emails = Array.from(new Set(targets.split(',').map(item => item.trim()).filter(Boolean)));
			if (emails.length === 0) return;

			await Promise.all(emails.map(async email => {

				try {
					await message.forward(email);
				} catch (e) {
					console.error(`转发邮箱 ${email} 失败：`, e);
				}

			}));

		}

	} catch (e) {
		console.error('邮件接收异常: ', e);

		if (e?.name === 'BizError') {
			message.setReject(e.message);
			return;
		}

		const msg = String(e?.message || e);

		if (msg === `Cannot read properties of undefined (reading 'prepare')` || /\.env\.db\.\w+ is not a function/.test(msg)) {
			message.setReject('D1数据库未绑定或被同名变量覆盖 D1 database not bound/overridden');
			return;
		}

		if (msg === `Cannot read properties of undefined (reading 'get')` || msg === `Cannot read properties of undefined (reading 'put')` || /\.env\.kv\.\w+ is not a function/.test(msg)) {
			message.setReject('KV数据库未绑定或被同名变量覆盖 KV database not bound/overridden');
			return;
		}

		throw e;
	}
}

function banEmailHandler(banEmailType, message, email) {

	if (banEmailType === roleConst.banEmailType.ALL) {
		message.setReject('Mailbox disabled');
		return false;
	}

	if (banEmailType === roleConst.banEmailType.CONTENT) {
		email.html = 'The content has been deleted';
		email.text = 'The content has been deleted';
		email.attachments = [];
	}

	return true;

}
