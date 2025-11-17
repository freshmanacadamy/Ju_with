require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ==================== CONFIGURATION ====================
const CONFIG = {
  BOT: {
    STATUS: { ACTIVE: 'active', MAINTENANCE: 'maintenance' }
  },
  USER: {
    STATUS: { ACTIVE: 'active', BLOCKED: 'blocked', PENDING: 'pending' }
  },
  PAYMENT: {
    DEFAULT_AMOUNT: 500,
    STATUS: { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' }
  },
  WITHDRAWAL: {
    MIN_PAID_REFERRALS: 4,
    MIN_AMOUNT: 100,
    COMMISSION_PER_REFERRAL: 250,
    STATUS: { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' }
  },
  ADMIN: {
    ROLES: { SUPER_ADMIN: 'super_admin', ADMIN: 'admin', MODERATOR: 'moderator' }
  }
};

// ==================== DATA STORAGE ====================
let users = new Map();
let payments = new Map();
let withdrawals = new Map();
let referrals = new Map();
let botSettings = {
  status: CONFIG.BOT.STATUS.ACTIVE,
  features: {
    registration: true,
    screenshot_upload: true,
    payments: true,
    referrals: true,
    withdrawals: true
  },
  maintenance_message: '🚧 Bot is under maintenance. Please try again later.',
  payment_methods: {
    telebirr: {
      account_name: 'JU Registration',
      account_number: '251912345678',
      active: true,
      instructions: 'Send via Telebirr App to this number'
    },
    cbe: {
      account_name: 'JU University',
      account_number: '1000234567890',
      active: true,
      instructions: 'Transfer to CBE Account'
    }
  }
};

// ==================== HELPER FUNCTIONS ====================
function isAdmin(userId) {
  const adminIds = process.env.ADMIN_IDS?.split(',') || [];
  return adminIds.includes(userId.toString());
}

function generateReferralCode(firstName) {
  const randomNum = Math.floor(100 + Math.random() * 900);
  return `${firstName.substring(0, 3).toUpperCase()}${randomNum}`;
}

function getUserLevel(paidReferrals) {
  if (paidReferrals >= 50) return { level: 5, title: '🌟 Elite' };
  if (paidReferrals >= 25) return { level: 4, title: '🔥 Pro' };
  if (paidReferrals >= 15) return { level: 3, title: '💎 Advanced' };
  if (paidReferrals >= 8) return { level: 2, title: '⭐ Intermediate' };
  if (paidReferrals >= 1) return { level: 1, title: '🚀 Beginner' };
  return { level: 0, title: '🌱 New' };
}

async function notifyAdmins(message, keyboard = null) {
  const adminIds = process.env.ADMIN_IDS?.split(',') || [];
  for (const adminId of adminIds) {
    try {
      if (keyboard) {
        await bot.telegram.sendMessage(adminId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } else {
        await bot.telegram.sendMessage(adminId, message, {
          parse_mode: 'Markdown'
        });
      }
    } catch (error) {
      console.error(`Failed to notify admin ${adminId}:`, error);
    }
  }
}

// ==================== MIDDLEWARE ====================
bot.use(async (ctx, next) => {
  // Initialize session
  ctx.session = ctx.session || {};
  
  // Get user data
  const userData = users.get(ctx.from?.id);
  ctx.userData = userData;
  
  // Check if user is blocked
  if (userData?.status === CONFIG.USER.STATUS.BLOCKED) {
    await ctx.reply('❌ Your account has been blocked. Contact admin for support.');
    return;
  }
  
  // Check maintenance mode
  if (botSettings.status === CONFIG.BOT.STATUS.MAINTENANCE && !isAdmin(ctx.from?.id)) {
    await ctx.reply(botSettings.maintenance_message);
    return;
  }
  
  await next();
});

// ==================== START & REGISTRATION ====================
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  
  // Check if registration is enabled
  if (!botSettings.features.registration && !users.has(userId)) {
    return ctx.reply('❌ Registration is currently disabled.');
  }
  
  if (!users.has(userId)) {
    // New user registration
    const referralCode = generateReferralCode(ctx.from.first_name);
    const referredBy = ctx.startPayload; // Get referral code from deep link
    
    const userData = {
      telegramId: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name || '',
      language: 'en',
      status: CONFIG.USER.STATUS.ACTIVE,
      balance: 0,
      totalEarned: 0,
      totalWithdrawn: 0,
      paidReferrals: 0,
      unpaidReferrals: 0,
      totalReferrals: 0,
      referralCode: referralCode,
      registrationDate: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
    
    users.set(userId, userData);
    
    // Handle referral
    if (referredBy) {
      const referrer = Array.from(users.values()).find(u => u.referralCode === referredBy);
      if (referrer) {
        // Update referrer stats
        users.set(referrer.telegramId, {
          ...referrer,
          totalReferrals: referrer.totalReferrals + 1,
          unpaidReferrals: referrer.unpaidReferrals + 1
        });
        
        // Store referral record
        referrals.set(`${referrer.telegramId}_${userId}`, {
          referrerId: referrer.telegramId,
          referredUserId: userId,
          status: 'pending',
          date: new Date().toISOString()
        });
      }
    }
    
    await ctx.reply(`🎉 Welcome to JU Registration Bot, ${ctx.from.first_name}!\n\nStart earning by referring friends! Each successful referral earns you ${CONFIG.WITHDRAWAL.COMMISSION_PER_REFERRAL} ETB.`);
  }
  
  await showMainMenu(ctx);
});

// ==================== MAIN MENU ====================
async function showMainMenu(ctx) {
  const menuText = `🎯 *Main Menu*\n\nChoose an option:`;
  
  const keyboard = Markup.keyboard([
    ['💰 Balance', '👥 My Referrals'],
    ['🏆 Leaderboard', '💸 Withdraw'],
    [isAdmin(ctx.from.id) ? '🔧 Admin' : '⚙️ Settings']
  ]).resize();
  
  await ctx.replyWithMarkdown(menuText, keyboard);
}

bot.command('menu', async (ctx) => {
  await showMainMenu(ctx);
});

// ==================== BALANCE COMMAND ====================
bot.hears('💰 Balance', async (ctx) => {
  const user = users.get(ctx.from.id);
  if (!user) return ctx.reply('Please use /start first.');
  
  const needed = CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS - user.paidReferrals;
  const eligible = user.paidReferrals >= CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS;
  const userLevel = getUserLevel(user.paidReferrals);
  
  const balanceText = `💰 *Your Balance*\n\n` +
    `🎖️ Level: ${userLevel.title}\n` +
    `💵 Available Balance: *${user.balance} ETB*\n` +
    `📈 Total Earned: *${user.totalEarned} ETB*\n` +
    `📉 Total Withdrawn: *${user.totalWithdrawn} ETB*\n\n` +
    `👥 Referral Stats:\n` +
    `✅ Paid Referrals: *${user.paidReferrals}*\n` +
    `⏳ Unpaid Referrals: *${user.unpaidReferrals}*\n` +
    `📊 Total Referrals: *${user.totalReferrals}*\n\n` +
    (eligible ? 
      `🎉 *You are eligible for withdrawal!*` : 
      `❌ Need *${needed}* more paid referrals to withdraw`);
  
  await ctx.replyWithMarkdown(balanceText);
});

bot.command('balance', async (ctx) => {
  const user = users.get(ctx.from.id);
  if (!user) return ctx.reply('Please use /start first.');
  
  const needed = CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS - user.paidReferrals;
  const eligible = user.paidReferrals >= CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS;
  const userLevel = getUserLevel(user.paidReferrals);
  
  const balanceText = `💰 *Your Balance*\n\n` +
    `🎖️ Level: ${userLevel.title}\n` +
    `💵 Available Balance: *${user.balance} ETB*\n` +
    `📈 Total Earned: *${user.totalEarned} ETB*\n` +
    `📉 Total Withdrawn: *${user.totalWithdrawn} ETB*\n\n` +
    `👥 Referral Stats:\n` +
    `✅ Paid Referrals: *${user.paidReferrals}*\n` +
    `⏳ Unpaid Referrals: *${user.unpaidReferrals}*\n` +
    `📊 Total Referrals: *${user.totalReferrals}*\n\n` +
    (eligible ? 
      `🎉 *You are eligible for withdrawal!*` : 
      `❌ Need *${needed}* more paid referrals to withdraw`);
  
  await ctx.replyWithMarkdown(balanceText);
});

// ==================== REFERRALS COMMAND ====================
bot.hears('👥 My Referrals', async (ctx) => {
  const user = users.get(ctx.from.id);
  if (!user) return ctx.reply('Please use /start first.');
  
  const referralText = `👥 *Your Referral Network*\n\n` +
    `Your Referral Code: \`${user.referralCode}\`\n\n` +
    `Share this link to invite friends:\n` +
    `https://t.me/${process.env.BOT_USERNAME}?start=${user.referralCode}\n\n` +
    `You earn *${CONFIG.WITHDRAWAL.COMMISSION_PER_REFERRAL} ETB* for each paid referral!\n\n` +
    `*Your Stats:*\n` +
    `✅ ${user.paidReferrals} paid • ⏳ ${user.unpaidReferrals} unpaid • 📊 ${user.totalReferrals} total`;
  
  await ctx.replyWithMarkdown(referralText);
});

bot.command('referrals', async (ctx) => {
  const user = users.get(ctx.from.id);
  if (!user) return ctx.reply('Please use /start first.');
  
  const referralText = `👥 *Your Referral Network*\n\n` +
    `Your Referral Code: \`${user.referralCode}\`\n\n` +
    `Share this link to invite friends:\n` +
    `https://t.me/${process.env.BOT_USERNAME}?start=${user.referralCode}\n\n` +
    `You earn *${CONFIG.WITHDRAWAL.COMMISSION_PER_REFERRAL} ETB* for each paid referral!\n\n` +
    `*Your Stats:*\n` +
    `✅ ${user.paidReferrals} paid • ⏳ ${user.unpaidReferrals} unpaid • 📊 ${user.totalReferrals} total`;
  
  await ctx.replyWithMarkdown(referralText);
});

// ==================== LEADERBOARD COMMAND ====================
bot.hears('🏆 Leaderboard', async (ctx) => {
  const topUsers = Array.from(users.values())
    .filter(u => u.paidReferrals > 0)
    .sort((a, b) => b.paidReferrals - a.paidReferrals)
    .slice(0, 6);
  
  const currentUser = users.get(ctx.from.id);
  
  let leaderboardText = `🏆 *Top Referrers*\n\n`;
  
  if (topUsers.length === 0) {
    leaderboardText += `No users on leaderboard yet. Be the first!`;
  } else {
    topUsers.forEach((user, index) => {
      const rankEmoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'][index];
      const userLevel = getUserLevel(user.paidReferrals);
      leaderboardText += `${rankEmoji} ${userLevel.title} *${user.firstName}*\n   📊 ${user.paidReferrals} paid • ${user.totalReferrals} total\n\n`;
    });
  }
  
  // Find user's rank
  const allUsers = Array.from(users.values())
    .filter(u => u.paidReferrals > 0)
    .sort((a, b) => b.paidReferrals - a.paidReferrals);
  
  const userRank = allUsers.findIndex(u => u.telegramId === ctx.from.id) + 1;
  const userLevel = getUserLevel(currentUser.paidReferrals);
  
  leaderboardText += `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `*Your Position:* ${userRank > 0 ? `#${userRank}` : 'Not ranked'}\n` +
    `*Your Level:* ${userLevel.title}\n` +
    `*Paid Referrals:* ${currentUser.paidReferrals}`;
  
  await ctx.replyWithMarkdown(leaderboardText);
});

bot.command('leaderboard', async (ctx) => {
  const topUsers = Array.from(users.values())
    .filter(u => u.paidReferrals > 0)
    .sort((a, b) => b.paidReferrals - a.paidReferrals)
    .slice(0, 6);
  
  const currentUser = users.get(ctx.from.id);
  
  let leaderboardText = `🏆 *Top Referrers*\n\n`;
  
  if (topUsers.length === 0) {
    leaderboardText += `No users on leaderboard yet. Be the first!`;
  } else {
    topUsers.forEach((user, index) => {
      const rankEmoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'][index];
      const userLevel = getUserLevel(user.paidReferrals);
      leaderboardText += `${rankEmoji} ${userLevel.title} *${user.firstName}*\n   📊 ${user.paidReferrals} paid • ${user.totalReferrals} total\n\n`;
    });
  }
  
  // Find user's rank
  const allUsers = Array.from(users.values())
    .filter(u => u.paidReferrals > 0)
    .sort((a, b) => b.paidReferrals - a.paidReferrals);
  
  const userRank = allUsers.findIndex(u => u.telegramId === ctx.from.id) + 1;
  const userLevel = getUserLevel(currentUser.paidReferrals);
  
  leaderboardText += `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `*Your Position:* ${userRank > 0 ? `#${userRank}` : 'Not ranked'}\n` +
    `*Your Level:* ${userLevel.title}\n` +
    `*Paid Referrals:* ${currentUser.paidReferrals}`;
  
  await ctx.replyWithMarkdown(leaderboardText);
});

// ==================== PAYMENT METHODS ====================
bot.hears('💳 Payment Methods', async (ctx) => {
  if (!botSettings.features.payments) {
    return ctx.reply('❌ Payment feature is currently disabled.');
  }
  
  let paymentText = `💳 *Available Payment Methods*\n\n`;
  
  Object.entries(botSettings.payment_methods).forEach(([method, data]) => {
    if (data.active) {
      paymentText += `📱 *${method.toUpperCase()}*\n` +
        `Account: \`${data.account_number}\`\n` +
        `Name: ${data.account_name}\n` +
        `Instructions: ${data.instructions}\n\n`;
    }
  });
  
  paymentText += `*After payment, send screenshot as proof.*`;
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📸 Send Screenshot', 'upload_screenshot')]
  ]);
  
  await ctx.replyWithMarkdown(paymentText, keyboard);
});

// ==================== CONTINUE TO PART 2 ====================
// ==================== WITHDRAWAL SYSTEM ====================
bot.hears('💸 Withdraw', async (ctx) => {
  if (!botSettings.features.withdrawals) {
    return ctx.reply('❌ Withdrawal feature is currently disabled.');
  }
  
  const user = users.get(ctx.from.id);
  if (!user) return ctx.reply('Please use /start first.');
  
  // Check eligibility
  if (user.paidReferrals < CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS) {
    const needed = CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS - user.paidReferrals;
    return ctx.reply(
      `❌ *Withdrawal Not Eligible*\n\n` +
      `You need *${CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS}* paid referrals to withdraw.\n` +
      `You have *${user.paidReferrals}* paid referrals.\n` +
      `Need *${needed}* more paid referrals.`
    );
  }
  
  if (user.balance < CONFIG.WITHDRAWAL.MIN_AMOUNT) {
    return ctx.reply(
      `❌ *Insufficient Balance*\n\n` +
      `Minimum withdrawal amount: *${CONFIG.WITHDRAWAL.MIN_AMOUNT} ETB*\n` +
      `Your balance: *${user.balance} ETB*`
    );
  }
  
  const withdrawalText = `💸 *Request Withdrawal*\n\n` +
    `Available Balance: *${user.balance} ETB*\n` +
    `Minimum Withdrawal: *${CONFIG.WITHDRAWAL.MIN_AMOUNT} ETB*\n\n` +
    `Please send the withdrawal details in this format:\n\n` +
    `\`Amount|PaymentMethod|AccountNumber\`\n\n` +
    `*Example:*\n` +
    `\`1000|telebirr|251912345678\`\n\n` +
    `*Available Methods:* ${Object.keys(botSettings.payment_methods).filter(m => botSettings.payment_methods[m].active).join(', ')}`;
  
  ctx.session.waitingForWithdrawal = true;
  await ctx.replyWithMarkdown(withdrawalText);
});

bot.command('withdraw', async (ctx) => {
  if (!botSettings.features.withdrawals) {
    return ctx.reply('❌ Withdrawal feature is currently disabled.');
  }
  
  const user = users.get(ctx.from.id);
  if (!user) return ctx.reply('Please use /start first.');
  
  // Check eligibility
  if (user.paidReferrals < CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS) {
    const needed = CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS - user.paidReferrals;
    return ctx.reply(
      `❌ *Withdrawal Not Eligible*\n\n` +
      `You need *${CONFIG.WITHDRAWAL.MIN_PAID_REFERRALS}* paid referrals to withdraw.\n` +
      `You have *${user.paidReferrals}* paid referrals.\n` +
      `Need *${needed}* more paid referrals.`
    );
  }
  
  if (user.balance < CONFIG.WITHDRAWAL.MIN_AMOUNT) {
    return ctx.reply(
      `❌ *Insufficient Balance*\n\n` +
      `Minimum withdrawal amount: *${CONFIG.WITHDRAWAL.MIN_AMOUNT} ETB*\n` +
      `Your balance: *${user.balance} ETB*`
    );
  }
  
  const withdrawalText = `💸 *Request Withdrawal*\n\n` +
    `Available Balance: *${user.balance} ETB*\n` +
    `Minimum Withdrawal: *${CONFIG.WITHDRAWAL.MIN_AMOUNT} ETB*\n\n` +
    `Please send the withdrawal details in this format:\n\n` +
    `\`Amount|PaymentMethod|AccountNumber\`\n\n` +
    `*Example:*\n` +
    `\`1000|telebirr|251912345678\`\n\n` +
    `*Available Methods:* ${Object.keys(botSettings.payment_methods).filter(m => botSettings.payment_methods[m].active).join(', ')}`;
  
  ctx.session.waitingForWithdrawal = true;
  await ctx.replyWithMarkdown(withdrawalText);
});

// ==================== PAYMENT SCREENSHOT HANDLING ====================
bot.on('photo', async (ctx) => {
  if (!botSettings.features.screenshot_upload) {
    return ctx.reply('❌ Screenshot upload is currently disabled.');
  }
  
  const user = users.get(ctx.from.id);
  if (!user) return;
  
  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  const fileId = photo.file_id;
  
  try {
    const paymentId = `PAY_${ctx.from.id}_${Date.now()}`;
    const paymentData = {
      paymentId: paymentId,
      userId: ctx.from.id,
      screenshotFileId: fileId,
      amount: CONFIG.PAYMENT.DEFAULT_AMOUNT,
      status: CONFIG.PAYMENT.STATUS.PENDING,
      submittedAt: new Date().toISOString(),
      method: 'manual'
    };
    
    payments.set(paymentId, paymentData);
    
    // Notify admins
    const notificationText = `📸 *NEW PAYMENT SUBMISSION*\n\n` +
      `👤 User: ${user.firstName} ${user.lastName || ''}\n` +
      `📱 Username: @${user.username || 'N/A'}\n` +
      `🆔 User ID: ${ctx.from.id}\n` +
      `💰 Amount: ${CONFIG.PAYMENT.DEFAULT_AMOUNT} ETB\n` +
      `🆔 Payment ID: ${paymentId}\n` +
      `⏰ Time: ${new Date().toLocaleString()}\n\n` +
      `*Quick Actions:*`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve', `approve_payment_${paymentId}`),
        Markup.button.callback('❌ Reject', `reject_payment_${paymentId}`)
      ],
      [
        Markup.button.callback('📩 Message User', `message_user_${ctx.from.id}`),
        Markup.button.callback('👀 View User', `view_user_${ctx.from.id}`)
      ]
    ]);
    
    await notifyAdmins(notificationText, keyboard.reply_markup);
    
    // Forward screenshot to admins
    const adminIds = process.env.ADMIN_IDS?.split(',') || [];
    for (const adminId of adminIds) {
      try {
        await ctx.telegram.forwardMessage(adminId, ctx.from.id, ctx.message.message_id);
      } catch (error) {
        console.error(`Failed to forward screenshot to admin ${adminId}:`, error);
      }
    }
    
    await ctx.reply(
      `✅ *Payment Screenshot Received!*\n\n` +
      `Admins have been notified and will verify your payment shortly.\n` +
      `Payment ID: \`${paymentId}\`\n\n` +
      `You will receive a notification once verified.`
    );
  } catch (error) {
    console.error('Error processing payment screenshot:', error);
    await ctx.reply('❌ Error processing payment screenshot. Please try again.');
  }
});

// ==================== WITHDRAWAL INPUT HANDLER ====================
bot.on('text', async (ctx) => {
  if (ctx.session.waitingForWithdrawal) {
    const input = ctx.message.text.trim();
    const [amount, paymentMethod, accountNumber] = input.split('|');
    
    if (!amount || !paymentMethod || !accountNumber) {
      return ctx.reply('❌ Invalid format. Please use: Amount|PaymentMethod|AccountNumber');
    }
    
    const numericAmount = parseInt(amount);
    const user = users.get(ctx.from.id);
    
    if (isNaN(numericAmount) || numericAmount < CONFIG.WITHDRAWAL.MIN_AMOUNT) {
      return ctx.reply(`❌ Amount must be at least ${CONFIG.WITHDRAWAL.MIN_AMOUNT} ETB`);
    }
    
    if (numericAmount > user.balance) {
      return ctx.reply(`❌ Amount exceeds your available balance of ${user.balance} ETB`);
    }
    
    // Check if payment method is valid
    if (!botSettings.payment_methods[paymentMethod.toLowerCase()] || !botSettings.payment_methods[paymentMethod.toLowerCase()].active) {
      return ctx.reply(`❌ Invalid payment method. Available: ${Object.keys(botSettings.payment_methods).filter(m => botSettings.payment_methods[m].active).join(', ')}`);
    }
    
    try {
      const withdrawalId = `WD_${ctx.from.id}_${Date.now()}`;
      const withdrawalData = {
        withdrawalId: withdrawalId,
        userId: ctx.from.id,
        amount: numericAmount,
        paymentMethod: paymentMethod.toLowerCase(),
        accountNumber: accountNumber.trim(),
        status: CONFIG.WITHDRAWAL.STATUS.PENDING,
        requestedAt: new Date().toISOString()
      };
      
      withdrawals.set(withdrawalId, withdrawalData);
      
      // Notify admins
      const notificationText = `💰 *NEW WITHDRAWAL REQUEST*\n\n` +
        `👤 User: ${user.firstName} ${user.lastName || ''}\n` +
        `📱 Username: @${user.username || 'N/A'}\n` +
        `🆔 User ID: ${ctx.from.id}\n` +
        `💵 Amount: ${numericAmount} ETB\n` +
        `📊 Paid Referrals: ${user.paidReferrals}\n` +
        `💰 Current Balance: ${user.balance} ETB\n` +
        `💳 Method: ${paymentMethod}\n` +
        `🔢 Account: ${accountNumber}\n` +
        `🆔 Withdrawal ID: ${withdrawalId}\n\n` +
        `*Quick Actions:*`;
      
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Approve', `approve_withdrawal_${withdrawalId}`),
          Markup.button.callback('❌ Reject', `reject_withdrawal_${withdrawalId}`)
        ],
        [
          Markup.button.callback('📩 Message User', `message_user_${ctx.from.id}`),
          Markup.button.callback('👀 View Details', `view_withdrawal_${withdrawalId}`)
        ]
      ]);
      
      await notifyAdmins(notificationText, keyboard.reply_markup);
      
      await ctx.reply(
        `✅ *Withdrawal Request Submitted!*\n\n` +
        `Amount: *${numericAmount} ETB*\n` +
        `Method: *${paymentMethod}*\n` +
        `Account: *${accountNumber}*\n` +
        `Withdrawal ID: \`${withdrawalId}\`\n\n` +
        `Admins have been notified. You will receive an update soon.`
      );
      
      ctx.session.waitingForWithdrawal = false;
    } catch (error) {
      console.error('Error processing withdrawal:', error);
      await ctx.reply('❌ Error processing withdrawal request. Please try again.');
    }
  }
});

// ==================== PAYMENT APPROVAL HANDLER ====================
bot.action(/approve_payment_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('❌ Access denied.');
  }
  
  const paymentId = ctx.match[1];
  const payment = payments.get(paymentId);
  
  if (!payment) {
    return ctx.answerCbQuery('❌ Payment not found.');
  }
  
  try {
    // Update payment status
    payments.set(paymentId, {
      ...payment,
      status: CONFIG.PAYMENT.STATUS.APPROVED,
      verifiedBy: ctx.from.username,
      verifiedAt: new Date().toISOString()
    });
    
    // Update user balance and referral stats
    const user = users.get(payment.userId);
    if (user) {
      const newBalance = user.balance + CONFIG.WITHDRAWAL.COMMISSION_PER_REFERRAL;
      
      users.set(payment.userId, {
        ...user,
        paidReferrals: user.paidReferrals + 1,
        unpaidReferrals: Math.max(0, user.unpaidReferrals - 1),
        balance: newBalance,
        totalEarned: user.totalEarned + CONFIG.WITHDRAWAL.COMMISSION_PER_REFERRAL
      });
      
      // Update referral status if exists
      const referralKey = Array.from(referrals.entries())
        .find(([key, ref]) => ref.referredUserId === payment.userId && ref.status === 'pending')?.[0];
      
      if (referralKey) {
        referrals.set(referralKey, {
          ...referrals.get(referralKey),
          status: 'paid'
        });
      }
      
      // Notify user
      await ctx.telegram.sendMessage(
        payment.userId,
        `🎉 *PAYMENT APPROVED!*\n\n` +
        `Your payment has been verified successfully!\n` +
        `You earned *${CONFIG.WITHDRAWAL.COMMISSION_PER_REFERRAL} ETB* from this payment.\n\n` +
        `💰 New Balance: *${newBalance} ETB*\n` +
        `✅ Paid Referrals: *${user.paidReferrals + 1}*`
      );
    }
    
    await ctx.editMessageText(`✅ Payment ${paymentId} approved successfully!`);
    await ctx.answerCbQuery('Payment approved!');
  } catch (error) {
    console.error('Error approving payment:', error);
    await ctx.answerCbQuery('❌ Error approving payment.');
  }
});

// ==================== WITHDRAWAL APPROVAL HANDLER ====================
bot.action(/approve_withdrawal_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('❌ Access denied.');
  }
  
  const withdrawalId = ctx.match[1];
  const withdrawal = withdrawals.get(withdrawalId);
  
  if (!withdrawal) {
    return ctx.answerCbQuery('❌ Withdrawal not found.');
  }
  
  try {
    // Update withdrawal status
    withdrawals.set(withdrawalId, {
      ...withdrawal,
      status: CONFIG.WITHDRAWAL.STATUS.APPROVED,
      processedBy: ctx.from.username,
      processedAt: new Date().toISOString()
    });
    
    // Update user balance
    const user = users.get(withdrawal.userId);
    if (user) {
      const newBalance = user.balance - withdrawal.amount;
      
      users.set(withdrawal.userId, {
        ...user,
        balance: newBalance,
        totalWithdrawn: user.totalWithdrawn + withdrawal.amount
      });
      
      // Notify user
      await ctx.telegram.sendMessage(
        withdrawal.userId,
        `🎉 *WITHDRAWAL APPROVED!*\n\n` +
        `Your withdrawal of *${withdrawal.amount} ETB* has been approved!\n` +
        `Funds will be sent to your ${withdrawal.paymentMethod} account.\n\n` +
        `💵 Withdrawn: *${withdrawal.amount} ETB*\n` +
        `💰 New Balance: *${newBalance} ETB*\n` +
        `💳 Method: ${withdrawal.paymentMethod}\n` +
        `🔢 Account: ${withdrawal.accountNumber}`
      );
    }
    
    await ctx.editMessageText(`✅ Withdrawal ${withdrawalId} approved successfully!`);
    await ctx.answerCbQuery('Withdrawal approved!');
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    await ctx.answerCbQuery('❌ Error approving withdrawal.');
  }
});

// ==================== PAYMENT REJECTION HANDLER ====================
bot.action(/reject_payment_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('❌ Access denied.');
  }
  
  const paymentId = ctx.match[1];
  const payment = payments.get(paymentId);
  
  if (!payment) {
    return ctx.answerCbQuery('❌ Payment not found.');
  }
  
  // Ask for rejection reason
  await ctx.editMessageText(
    `❌ Rejecting payment ${paymentId}\n\n` +
    `Please send the rejection reason:`
  );
  
  ctx.session.rejectingPayment = paymentId;
  ctx.session.rejectingPaymentType = 'payment';
});

// ==================== WITHDRAWAL REJECTION HANDLER ====================
bot.action(/reject_withdrawal_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('❌ Access denied.');
  }
  
  const withdrawalId = ctx.match[1];
  const withdrawal = withdrawals.get(withdrawalId);
  
  if (!withdrawal) {
    return ctx.answerCbQuery('❌ Withdrawal not found.');
  }
  
  // Ask for rejection reason
  await ctx.editMessageText(
    `❌ Rejecting withdrawal ${withdrawalId}\n\n` +
    `Please send the rejection reason:`
  );
  
  ctx.session.rejectingPayment = withdrawalId;
  ctx.session.rejectingPaymentType = 'withdrawal';
});

// ==================== REJECTION REASON HANDLER ====================
bot.on('text', async (ctx) => {
  if (ctx.session.rejectingPayment) {
    const reason = ctx.message.text;
    const paymentId = ctx.session.rejectingPayment;
    const type = ctx.session.rejectingPaymentType;
    
    if (type === 'payment') {
      const payment = payments.get(paymentId);
      if (payment) {
        payments.set(paymentId, {
          ...payment,
          status: CONFIG.PAYMENT.STATUS.REJECTED,
          rejectionReason: reason,
          verifiedBy: ctx.from.username,
          verifiedAt: new Date().toISOString()
        });
        
        // Notify user
        await ctx.telegram.sendMessage(
          payment.userId,
          `❌ *PAYMENT REJECTED*\n\n` +
          `Your payment has been rejected.\n\n` +
          `Reason: ${reason}\n\n` +
          `Please submit a valid payment screenshot.`
        );
      }
      
      await ctx.reply(`✅ Payment ${paymentId} rejected with reason.`);
      
    } else if (type === 'withdrawal') {
      const withdrawal = withdrawals.get(paymentId);
      if (withdrawal) {
        withdrawals.set(paymentId, {
          ...withdrawal,
          status: CONFIG.WITHDRAWAL.STATUS.REJECTED,
          rejectionReason: reason,
          processedBy: ctx.from.username,
          processedAt: new Date().toISOString()
        });
        
        // Notify user
        await ctx.telegram.sendMessage(
          withdrawal.userId,
          `❌ *WITHDRAWAL REJECTED*\n\n` +
          `Your withdrawal request has been rejected.\n\n` +
          `Reason: ${reason}\n\n` +
          `You can submit a new withdrawal request.`
        );
      }
      
      await ctx.reply(`✅ Withdrawal ${paymentId} rejected with reason.`);
    }
    
    // Clear session
    ctx.session.rejectingPayment = null;
    ctx.session.rejectingPaymentType = null;
  }
});

// ==================== CONTINUE TO PART 3 ====================
// ==================== ADMIN DASHBOARD ====================
bot.hears('🔧 Admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const stats = await getAdminStats();
  
  const adminText = `🔧 *Admin Dashboard*\n\n` +
    `📊 *Statistics*\n` +
    `👥 Total Users: ${stats.totalUsers}\n` +
    `💰 Total Payments: ${stats.totalPayments}\n` +
    `⏳ Pending Payments: ${stats.pendingPayments}\n` +
    `💸 Pending Withdrawals: ${stats.pendingWithdrawals}\n` +
    `📈 Total Revenue: ${stats.totalRevenue} ETB\n\n` +
    `⚡ *Quick Actions*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📸 Pending Payments', 'admin_pending_payments'),
      Markup.button.callback('💸 Pending Withdrawals', 'admin_pending_withdrawals')
    ],
    [
      Markup.button.callback('👥 User Management', 'admin_user_management'),
      Markup.button.callback('📊 Analytics', 'admin_analytics')
    ],
    [
      Markup.button.callback('⚙️ Bot Settings', 'admin_bot_settings'),
      Markup.button.callback('📢 Broadcast', 'admin_broadcast')
    ],
    [
      Markup.button.callback('📤 Export Data', 'admin_export_data'),
      Markup.button.callback('🔄 Refresh', 'admin_refresh')
    ]
  ]);
  
  await ctx.replyWithMarkdown(adminText, keyboard);
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const stats = await getAdminStats();
  
  const adminText = `🔧 *Admin Dashboard*\n\n` +
    `📊 *Statistics*\n` +
    `👥 Total Users: ${stats.totalUsers}\n` +
    `💰 Total Payments: ${stats.totalPayments}\n` +
    `⏳ Pending Payments: ${stats.pendingPayments}\n` +
    `💸 Pending Withdrawals: ${stats.pendingWithdrawals}\n` +
    `📈 Total Revenue: ${stats.totalRevenue} ETB\n\n` +
    `⚡ *Quick Actions*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📸 Pending Payments', 'admin_pending_payments'),
      Markup.button.callback('💸 Pending Withdrawals', 'admin_pending_withdrawals')
    ],
    [
      Markup.button.callback('👥 User Management', 'admin_user_management'),
      Markup.button.callback('📊 Analytics', 'admin_analytics')
    ],
    [
      Markup.button.callback('⚙️ Bot Settings', 'admin_bot_settings'),
      Markup.button.callback('📢 Broadcast', 'admin_broadcast')
    ],
    [
      Markup.button.callback('📤 Export Data', 'admin_export_data'),
      Markup.button.callback('🔄 Refresh', 'admin_refresh')
    ]
  ]);
  
  await ctx.replyWithMarkdown(adminText, keyboard);
});

// ==================== ADMIN STATS FUNCTION ====================
async function getAdminStats() {
  const totalUsers = users.size;
  const totalPayments = Array.from(payments.values()).length;
  const pendingPayments = Array.from(payments.values()).filter(p => p.status === CONFIG.PAYMENT.STATUS.PENDING).length;
  const pendingWithdrawals = Array.from(withdrawals.values()).filter(w => w.status === CONFIG.WITHDRAWAL.STATUS.PENDING).length;
  const totalRevenue = Array.from(payments.values())
    .filter(p => p.status === CONFIG.PAYMENT.STATUS.APPROVED)
    .reduce((sum, p) => sum + p.amount, 0);
  
  return {
    totalUsers,
    totalPayments,
    pendingPayments,
    pendingWithdrawals,
    totalRevenue
  };
}

// ==================== ADMIN PENDING PAYMENTS ====================
bot.action('admin_pending_payments', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const pendingPayments = Array.from(payments.values())
    .filter(p => p.status === CONFIG.PAYMENT.STATUS.PENDING)
    .slice(0, 10);
  
  if (pendingPayments.length === 0) {
    return ctx.editMessageText('✅ No pending payments.');
  }
  
  await ctx.editMessageText(`📸 *Pending Payments (${pendingPayments.length})*\n\nSelect a payment to view:`);
  
  for (const payment of pendingPayments) {
    const user = users.get(payment.userId);
    const paymentText = `📸 *Pending Payment*\n\n` +
      `👤 User: ${user?.firstName || 'Unknown'}\n` +
      `📱 Username: @${user?.username || 'N/A'}\n` +
      `💰 Amount: ${payment.amount} ETB\n` +
      `🆔 Payment ID: ${payment.paymentId}\n` +
      `📅 Submitted: ${new Date(payment.submittedAt).toLocaleString()}`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve', `approve_payment_${payment.paymentId}`),
        Markup.button.callback('❌ Reject', `reject_payment_${payment.paymentId}`)
      ],
      [
        Markup.button.callback('📩 Message User', `message_user_${payment.userId}`),
        Markup.button.callback('👀 View User', `view_user_${payment.userId}`)
      ]
    ]);
    
    await ctx.replyWithMarkdown(paymentText, keyboard);
    
    // Forward screenshot
    try {
      await ctx.telegram.forwardMessage(ctx.from.id, payment.userId, payment.screenshotFileId);
    } catch (error) {
      console.error('Error forwarding screenshot:', error);
    }
  }
});

// ==================== ADMIN PENDING WITHDRAWALS ====================
bot.action('admin_pending_withdrawals', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const pendingWithdrawals = Array.from(withdrawals.values())
    .filter(w => w.status === CONFIG.WITHDRAWAL.STATUS.PENDING)
    .slice(0, 10);
  
  if (pendingWithdrawals.length === 0) {
    return ctx.editMessageText('✅ No pending withdrawals.');
  }
  
  await ctx.editMessageText(`💸 *Pending Withdrawals (${pendingWithdrawals.length})*\n\nSelect a withdrawal to process:`);
  
  for (const withdrawal of pendingWithdrawals) {
    const user = users.get(withdrawal.userId);
    const withdrawalText = `💸 *Pending Withdrawal*\n\n` +
      `👤 User: ${user?.firstName || 'Unknown'}\n` +
      `📱 Username: @${user?.username || 'N/A'}\n` +
      `💵 Amount: ${withdrawal.amount} ETB\n` +
      `💳 Method: ${withdrawal.paymentMethod}\n` +
      `🔢 Account: ${withdrawal.accountNumber}\n` +
      `📊 Paid Referrals: ${user?.paidReferrals || 0}\n` +
      `💰 User Balance: ${user?.balance || 0} ETB\n` +
      `🆔 Withdrawal ID: ${withdrawal.withdrawalId}`;
    
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Approve', `approve_withdrawal_${withdrawal.withdrawalId}`),
        Markup.button.callback('❌ Reject', `reject_withdrawal_${withdrawal.withdrawalId}`)
      ],
      [
        Markup.button.callback('📩 Message User', `message_user_${withdrawal.userId}`),
        Markup.button.callback('👀 View User', `view_user_${withdrawal.userId}`)
      ]
    ]);
    
    await ctx.replyWithMarkdown(withdrawalText, keyboard);
  }
});

// ==================== ADMIN USER MANAGEMENT ====================
bot.action('admin_user_management', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const userManagementText = `👥 *User Management*\n\n` +
    `Total Users: ${users.size}\n` +
    `Active Users: ${Array.from(users.values()).filter(u => u.status === CONFIG.USER.STATUS.ACTIVE).length}\n` +
    `Blocked Users: ${Array.from(users.values()).filter(u => u.status === CONFIG.USER.STATUS.BLOCKED).length}\n\n` +
    `*User Actions:*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔍 Search User', 'admin_search_user'),
      Markup.button.callback('📋 List Users', 'admin_list_users')
    ],
    [
      Markup.button.callback('🚫 Block User', 'admin_block_user'),
      Markup.button.callback('✅ Unblock User', 'admin_unblock_user')
    ],
    [
      Markup.button.callback('✏️ Edit User', 'admin_edit_user'),
      Markup.button.callback('📊 User Stats', 'admin_user_stats')
    ],
    [
      Markup.button.callback('🔙 Back', 'admin_back')
    ]
  ]);
  
  await ctx.editMessageText(userManagementText, keyboard);
});

// ==================== ADMIN BOT SETTINGS ====================
bot.action('admin_bot_settings', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const settingsText = `⚙️ *Bot Settings*\n\n` +
    `🤖 Bot Status: ${botSettings.status === CONFIG.BOT.STATUS.ACTIVE ? '🟢 ACTIVE' : '🔴 MAINTENANCE'}\n\n` +
    `🔧 *Feature Toggles:*\n` +
    `📝 Registration: ${botSettings.features.registration ? '🟢 ON' : '🔴 OFF'}\n` +
    `📸 Screenshots: ${botSettings.features.screenshot_upload ? '🟢 ON' : '🔴 OFF'}\n` +
    `💰 Payments: ${botSettings.features.payments ? '🟢 ON' : '🔴 OFF'}\n` +
    `👥 Referrals: ${botSettings.features.referrals ? '🟢 ON' : '🔴 OFF'}\n` +
    `💸 Withdrawals: ${botSettings.features.withdrawals ? '🟢 ON' : '🔴 OFF'}\n\n` +
    `*Settings Actions:*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(botSettings.status === CONFIG.BOT.STATUS.ACTIVE ? '🔴 Maintenance Mode' : '🟢 Activate Bot', 'admin_toggle_bot_status'),
      Markup.button.callback('📝 Edit Welcome Message', 'admin_edit_welcome')
    ],
    [
      Markup.button.callback('💳 Payment Methods', 'admin_payment_methods'),
      Markup.button.callback('💰 Referral Commission', 'admin_referral_commission')
    ],
    [
      Markup.button.callback('🔄 Toggle All Features', 'admin_toggle_all_features'),
      Markup.button.callback('📊 Feature Settings', 'admin_feature_settings')
    ],
    [
      Markup.button.callback('🔙 Back', 'admin_back')
    ]
  ]);
  
  await ctx.editMessageText(settingsText, keyboard);
});

// ==================== ADMIN BROADCAST SYSTEM ====================
bot.action('admin_broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const broadcastText = `📢 *Broadcast Message*\n\n` +
    `Send a message to all ${users.size} users.\n\n` +
    `*Options:*\n` +
    `• Text announcements\n` +
    `• Important updates\n` +
    `• Promotional messages\n\n` +
    `Choose broadcast type:`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 Text Broadcast', 'admin_broadcast_text'),
      Markup.button.callback('🖼️ Photo Broadcast', 'admin_broadcast_photo')
    ],
    [
      Markup.button.callback('👥 Preview Users', 'admin_broadcast_preview'),
      Markup.button.callback('📊 Broadcast Stats', 'admin_broadcast_stats')
    ],
    [
      Markup.button.callback('🔙 Back', 'admin_back')
    ]
  ]);
  
  await ctx.editMessageText(broadcastText, keyboard);
});

// ==================== ADMIN EXPORT DATA ====================
bot.action('admin_export_data', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const exportText = `📤 *Export Data*\n\n` +
    `Export user and payment data for analysis.\n\n` +
    `*Available Exports:*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('👥 All Users', 'admin_export_all_users'),
      Markup.button.callback('✅ Paid Users', 'admin_export_paid_users')
    ],
    [
      Markup.button.callback('⏳ Unpaid Users', 'admin_export_unpaid_users'),
      Markup.button.callback('💰 Payments', 'admin_export_payments')
    ],
    [
      Markup.button.callback('💸 Withdrawals', 'admin_export_withdrawals'),
      Markup.button.callback('📊 Full Report', 'admin_export_full')
    ],
    [
      Markup.button.callback('🔙 Back', 'admin_back')
    ]
  ]);
  
  await ctx.editMessageText(exportText, keyboard);
});

// ==================== ADMIN EXPORT HANDLERS ====================
bot.action('admin_export_all_users', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  await ctx.answerCbQuery('⏳ Generating CSV file...');
  
  try {
    const usersArray = Array.from(users.values());
    let csv = 'User ID,Name,Username,Phone,Balance,Paid Referrals,Total Referrals,Status,Registration Date\n';
    
    usersArray.forEach(user => {
      csv += `${user.telegramId},"${user.firstName} ${user.lastName || ''}","${user.username || 'N/A'}","${user.phone || 'N/A'}",${user.balance},${user.paidReferrals},${user.totalReferrals},${user.status},"${user.registrationDate}"\n`;
    });
    
    const filename = `all_users_${new Date().toISOString().split('T')[0]}.csv`;
    
    await ctx.replyWithDocument({
      source: Buffer.from(csv, 'utf8'),
      filename: filename
    }, {
      caption: `📊 Exported: ${filename}\nTotal Users: ${usersArray.length}\nGenerated: ${new Date().toLocaleString()}`
    });
    
  } catch (error) {
    await ctx.reply('❌ Error generating export file.');
    console.error('Export error:', error);
  }
});

// ==================== ADMIN BACK BUTTON ====================
bot.action('admin_back', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const stats = await getAdminStats();
  
  const adminText = `🔧 *Admin Dashboard*\n\n` +
    `📊 *Statistics*\n` +
    `👥 Total Users: ${stats.totalUsers}\n` +
    `💰 Total Payments: ${stats.totalPayments}\n` +
    `⏳ Pending Payments: ${stats.pendingPayments}\n` +
    `💸 Pending Withdrawals: ${stats.pendingWithdrawals}\n` +
    `📈 Total Revenue: ${stats.totalRevenue} ETB\n\n` +
    `⚡ *Quick Actions*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📸 Pending Payments', 'admin_pending_payments'),
      Markup.button.callback('💸 Pending Withdrawals', 'admin_pending_withdrawals')
    ],
    [
      Markup.button.callback('👥 User Management', 'admin_user_management'),
      Markup.button.callback('📊 Analytics', 'admin_analytics')
    ],
    [
      Markup.button.callback('⚙️ Bot Settings', 'admin_bot_settings'),
      Markup.button.callback('📢 Broadcast', 'admin_broadcast')
    ],
    [
      Markup.button.callback('📤 Export Data', 'admin_export_data'),
      Markup.button.callback('🔄 Refresh', 'admin_refresh')
    ]
  ]);
  
  await ctx.editMessageText(adminText, keyboard);
});

// ==================== ADMIN REFRESH ====================
bot.action('admin_refresh', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  await ctx.answerCbQuery('🔄 Refreshing...');
  
  const stats = await getAdminStats();
  
  const adminText = `🔧 *Admin Dashboard*\n\n` +
    `📊 *Statistics*\n` +
    `👥 Total Users: ${stats.totalUsers}\n` +
    `💰 Total Payments: ${stats.totalPayments}\n` +
    `⏳ Pending Payments: ${stats.pendingPayments}\n` +
    `💸 Pending Withdrawals: ${stats.pendingWithdrawals}\n` +
    `📈 Total Revenue: ${stats.totalRevenue} ETB\n\n` +
    `⚡ *Quick Actions*`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📸 Pending Payments', 'admin_pending_payments'),
      Markup.button.callback('💸 Pending Withdrawals', 'admin_pending_withdrawals')
    ],
    [
      Markup.button.callback('👥 User Management', 'admin_user_management'),
      Markup.button.callback('📊 Analytics', 'admin_analytics')
    ],
    [
      Markup.button.callback('⚙️ Bot Settings', 'admin_bot_settings'),
      Markup.button.callback('📢 Broadcast', 'admin_broadcast')
    ],
    [
      Markup.button.callback('📤 Export Data', 'admin_export_data'),
      Markup.button.callback('🔄 Refresh', 'admin_refresh')
    ]
  ]);
  
  await ctx.editMessageText(adminText, keyboard);
});

// ==================== MESSAGE USER HANDLER ====================
bot.action(/message_user_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const userId = ctx.match[1];
  const user = users.get(userId);
  
  if (!user) {
    return ctx.answerCbQuery('❌ User not found.');
  }
  
  await ctx.editMessageText(
    `📩 Message User: ${user.firstName} (@${user.username || 'N/A'})\n\n` +
    `Please type your message:`
  );
  
  ctx.session.messagingUser = userId;
});

// ==================== VIEW USER HANDLER ====================
bot.action(/view_user_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  
  const userId = ctx.match[1];
  const user = users.get(userId);
  
  if (!user) {
    return ctx.answerCbQuery('❌ User not found.');
  }
  
  const userLevel = getUserLevel(user.paidReferrals);
  const userText = `👤 *User Profile*\n\n` +
    `🆔 User ID: ${user.telegramId}\n` +
    `👤 Name: ${user.firstName} ${user.lastName || ''}\n` +
    `📱 Username: @${user.username || 'N/A'}\n` +
    `📞 Phone: ${user.phone || 'N/A'}\n` +
    `🎖️ Level: ${userLevel.title}\n` +
    `📊 Status: ${user.status}\n\n` +
    `💰 *Financial Info*\n` +
    `💵 Balance: ${user.balance} ETB\n` +
    `📈 Total Earned: ${user.totalEarned} ETB\n` +
    `📉 Total Withdrawn: ${user.totalWithdrawn} ETB\n\n` +
    `👥 *Referral Stats*\n` +
    `✅ Paid Referrals: ${user.paidReferrals}\n` +
    `⏳ Unpaid Referrals: ${user.unpaidReferrals}\n` +
    `📊 Total Referrals: ${user.totalReferrals}\n\n` +
    `📅 Registered: ${new Date(user.registrationDate).toLocaleString()}\n` +
    `⏰ Last Seen: ${new Date(user.lastSeen).toLocaleString()}`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📩 Message User', `message_user_${userId}`),
      Markup.button.callback('✏️ Edit User', `admin_edit_user_${userId}`)
    ],
    [
      Markup.button.callback(user.status === CONFIG.USER.STATUS.ACTIVE ? '🚫 Block User' : '✅ Unblock User', `admin_toggle_block_${userId}`),
      Markup.button.callback('💰 Adjust Balance', `admin_adjust_balance_${userId}`)
    ],
    [
      Markup.button.callback('🔙 Back', 'admin_user_management')
    ]
  ]);
  
  await ctx.editMessageText(userText, keyboard);
});

// ==================== ADMIN MESSAGE HANDLER ====================
bot.on('text', async (ctx) => {
  if (ctx.session.messagingUser) {
    const userId = ctx.session.messagingUser;
    const message = ctx.message.text;
    const user = users.get(userId);
    
    try {
      await ctx.telegram.sendMessage(
        userId,
        `📩 *Message from Admin*\n\n${message}`
      );
      
      await ctx.reply(`✅ Message sent to ${user.firstName} (@${user.username || 'N/A'})`);
      
      // Clear session
      ctx.session.messagingUser = null;
    } catch (error) {
      await ctx.reply(`❌ Failed to send message to user. They may have blocked the bot.`);
      ctx.session.messagingUser = null;
    }
  }
});

// ==================== HELP COMMAND ====================
bot.help((ctx) => {
  ctx.replyWithMarkdown(`
🤖 *JU Registration Bot Help*

*Main Commands:*
/start - Start the bot
/menu - Show main menu
/balance - Check your balance & referrals
/referrals - Get your referral link
/leaderboard - See top users
/withdraw - Request withdrawal

*For Users:*
• Send payment screenshot to submit payment
• Share your referral link to earn money
• Need 4 paid referrals to withdraw

*For Admins:*
/admin - Access admin dashboard

*Support:*
Contact admin if you need help.
  `);
});

// ==================== ADMIN TEXT COMMANDS ====================

// List all registered users
bot.command('registered', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const usersArray = Array.from(users.values());
  const activeUsers = usersArray.filter(u => u.status === CONFIG.USER.STATUS.ACTIVE);
  const blockedUsers = usersArray.filter(u => u.status === CONFIG.USER.STATUS.BLOCKED);
  
  const statsText = `📊 *Registered Users*\n\n` +
    `👥 Total Users: ${usersArray.length}\n` +
    `✅ Active Users: ${activeUsers.length}\n` +
    `🚫 Blocked Users: ${blockedUsers.length}\n` +
    `📈 Paid Referrals Total: ${usersArray.reduce((sum, user) => sum + user.paidReferrals, 0)}\n` +
    `💰 Total Balance: ${usersArray.reduce((sum, user) => sum + user.balance, 0)} ETB`;
  
  await ctx.replyWithMarkdown(statsText);
});

// List users command
bot.command('users', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const usersArray = Array.from(users.values())
    .sort((a, b) => new Date(b.registrationDate) - new Date(a.registrationDate))
    .slice(0, 20);
  
  let usersText = `👥 *Recent Users (Last 20)*\n\n`;
  
  if (usersArray.length === 0) {
    usersText += `No users registered yet.`;
  } else {
    usersArray.forEach((user, index) => {
      usersText += `${index + 1}. ${user.firstName} (@${user.username || 'no_username'})\n` +
        `   🆔: ${user.telegramId} | 💰: ${user.balance} ETB\n` +
        `   ✅ ${user.paidReferrals} paid | 📊 ${user.totalReferrals} total\n` +
        `   📅 ${new Date(user.registrationDate).toLocaleDateString()}\n\n`;
    });
  }
  
  await ctx.replyWithMarkdown(usersText);
});

// User profile command
bot.command('user', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const userId = ctx.message.text.split(' ')[1];
  if (!userId) {
    return ctx.reply('Usage: /user <user_id>');
  }
  
  const user = users.get(userId) || Array.from(users.values()).find(u => u.username === userId);
  if (!user) {
    return ctx.reply('❌ User not found.');
  }
  
  const userLevel = getUserLevel(user.paidReferrals);
  const userText = `👤 *User Profile*\n\n` +
    `🆔 User ID: ${user.telegramId}\n` +
    `👤 Name: ${user.firstName} ${user.lastName || ''}\n` +
    `📱 Username: @${user.username || 'N/A'}\n` +
    `🎖️ Level: ${userLevel.title}\n` +
    `📊 Status: ${user.status}\n\n` +
    `💰 Balance: ${user.balance} ETB\n` +
    `📈 Total Earned: ${user.totalEarned} ETB\n` +
    `📉 Total Withdrawn: ${user.totalWithdrawn} ETB\n\n` +
    `👥 Referrals: ${user.paidReferrals} paid / ${user.unpaidReferrals} unpaid / ${user.totalReferrals} total\n\n` +
    `📅 Registered: ${new Date(user.registrationDate).toLocaleString()}\n` +
    `⏰ Last Seen: ${new Date(user.lastSeen).toLocaleString()}`;
  
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📩 Message', `message_user_${user.telegramId}`),
      Markup.button.callback(user.status === CONFIG.USER.STATUS.ACTIVE ? '🚫 Block' : '✅ Unblock', `admin_toggle_block_${user.telegramId}`)
    ],
    [
      Markup.button.callback('💰 Adjust Balance', `admin_adjust_balance_${user.telegramId}`),
      Markup.button.callback('📊 Edit Referrals', `admin_edit_refs_${user.telegramId}`)
    ]
  ]);
  
  await ctx.replyWithMarkdown(userText, keyboard);
});

// Block user command
bot.command('block', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Usage: /block <user_id>');
  }
  
  const userId = args[1];
  const user = users.get(userId);
  
  if (!user) {
    return ctx.reply('❌ User not found.');
  }
  
  users.set(userId, {
    ...user,
    status: CONFIG.USER.STATUS.BLOCKED,
    blockReason: 'Manual block by admin',
    blockedAt: new Date().toISOString()
  });
  
  await ctx.reply(`✅ User ${user.firstName} (@${user.username || 'N/A'}) has been blocked.`);
});

// Unblock user command
bot.command('unblock', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Usage: /unblock <user_id>');
  }
  
  const userId = args[1];
  const user = users.get(userId);
  
  if (!user) {
    return ctx.reply('❌ User not found.');
  }
  
  users.set(userId, {
    ...user,
    status: CONFIG.USER.STATUS.ACTIVE,
    blockReason: null,
    blockedAt: null
  });
  
  await ctx.reply(`✅ User ${user.firstName} (@${user.username || 'N/A'}) has been unblocked.`);
});

// Payments command
bot.command('payments', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const pendingPayments = Array.from(payments.values())
    .filter(p => p.status === CONFIG.PAYMENT.STATUS.PENDING);
  
  if (pendingPayments.length === 0) {
    return ctx.reply('✅ No pending payments.');
  }
  
  let paymentsText = `📸 *Pending Payments (${pendingPayments.length})*\n\n`;
  
  pendingPayments.forEach((payment, index) => {
    const user = users.get(payment.userId);
    paymentsText += `${index + 1}. ${user?.firstName || 'Unknown'} (@${user?.username || 'N/A'})\n` +
      `   💰 ${payment.amount} ETB | 🆔 ${payment.paymentId}\n` +
      `   📅 ${new Date(payment.submittedAt).toLocaleString()}\n\n`;
  });
  
  await ctx.replyWithMarkdown(paymentsText);
});

// Stats command
bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const stats = await getAdminStats();
  const usersArray = Array.from(users.values());
  
  const topReferrers = usersArray
    .filter(u => u.paidReferrals > 0)
    .sort((a, b) => b.paidReferrals - a.paidReferrals)
    .slice(0, 5);
  
  let statsText = `📊 *Bot Statistics*\n\n` +
    `👥 Users: ${stats.totalUsers} total\n` +
    `💰 Payments: ${stats.totalPayments} total | ${stats.pendingPayments} pending\n` +
    `💸 Withdrawals: ${stats.pendingWithdrawals} pending\n` +
    `📈 Revenue: ${stats.totalRevenue} ETB\n\n` +
    `🏆 *Top Referrers:*\n`;
  
  if (topReferrers.length === 0) {
    statsText += `No top referrers yet.\n`;
  } else {
    topReferrers.forEach((user, index) => {
      statsText += `${index + 1}. ${user.firstName} - ${user.paidReferrals} paid referrals\n`;
    });
  }
  
  statsText += `\n⚙️ *Bot Status:* ${botSettings.status === CONFIG.BOT.STATUS.ACTIVE ? '🟢 ACTIVE' : '🔴 MAINTENANCE'}`;
  
  await ctx.replyWithMarkdown(statsText);
});

// Export users command
bot.command('export_users', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const usersArray = Array.from(users.values());
  let csv = 'User ID,Name,Username,Phone,Balance,Paid Referrals,Total Referrals,Status,Registration Date\n';
  
  usersArray.forEach(user => {
    csv += `${user.telegramId},"${user.firstName} ${user.lastName || ''}","${user.username || 'N/A'}","${user.phone || 'N/A'}",${user.balance},${user.paidReferrals},${user.totalReferrals},${user.status},"${user.registrationDate}"\n`;
  });
  
  const filename = `users_export_${new Date().toISOString().split('T')[0]}.csv`;
  
  await ctx.replyWithDocument({
    source: Buffer.from(csv, 'utf8'),
    filename: filename
  }, {
    caption: `📊 Exported: ${filename}\nTotal Users: ${usersArray.length}`
  });
});

// Broadcast command
bot.command('broadcast', async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Access denied. Admin only.');
  }
  
  const message = ctx.message.text.replace('/broadcast', '').trim();
  if (!message) {
    return ctx.reply('Usage: /broadcast <your_message>');
  }
  
  const usersArray = Array.from(users.values());
  let successCount = 0;
  let failCount = 0;
  
  await ctx.reply(`📢 Starting broadcast to ${usersArray.length} users...`);
  
  for (const user of usersArray) {
    try {
      await ctx.telegram.sendMessage(
        user.telegramId,
        `📢 *ANNOUNCEMENT*\n\n${message}`
      );
      successCount++;
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      failCount++;
    }
  }
  
  await ctx.reply(
    `✅ *Broadcast Completed*\n\n` +
    `📨 Sent to: ${successCount} users\n` +
    `❌ Failed: ${failCount} users\n` +
    `📊 Success rate: ${((successCount / usersArray.length) * 100).toFixed(1)}%`
  );
});

// ==================== VERCEL WEBHOOK HANDLER ====================
module.exports = async (req, res) => {
  try {
    console.log('🤖 Webhook received');
    await bot.handleUpdate(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(200).send('OK'); // Always return 200 to Telegram
  }
};

// ==================== LOCAL DEVELOPMENT ====================
if (process.env.NODE_ENV === 'development') {
  bot.launch().then(() => {
    console.log('🚀 JU Registration Bot started in development mode');
  });
  
  // Enable graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

console.log('✅ Bot module loaded successfully');
