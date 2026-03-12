package com.englishapp.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class PasswordResetEmailService {
    private static final Logger log = LoggerFactory.getLogger(PasswordResetEmailService.class);

    private final JavaMailSender mailSender;
    private final String frontendUrl;

    public PasswordResetEmailService(
            @org.springframework.beans.factory.annotation.Autowired(required = false) JavaMailSender mailSender,
            @Value("${app.frontend-url:http://localhost:5173}") String frontendUrl
    ) {
        this.mailSender = mailSender;
        this.frontendUrl = frontendUrl.replaceAll("/$", "");
    }

    public void sendPasswordResetEmail(String toEmail, String resetToken) {
        String resetLink = frontendUrl + "/#reset?token=" + resetToken;
        if (mailSender != null) {
            try {
                SimpleMailMessage message = new SimpleMailMessage();
                message.setTo(toEmail);
                message.setSubject("Password reset - English SRS");
                message.setText("To reset your password, open this link in your browser:\n\n" + resetLink + "\n\nThis link expires in 1 hour. If you didn't request a reset, ignore this email.");
                mailSender.send(message);
            } catch (Exception e) {
                log.warn("Failed to send password reset email to {}: {}. Reset link (for dev): {}", toEmail, e.getMessage(), resetLink);
            }
        } else {
            log.warn("Mail not configured. Password reset link for {}: {}", toEmail, resetLink);
        }
    }
}
