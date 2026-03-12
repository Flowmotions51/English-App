package com.englishapp.service;

import com.englishapp.model.PasswordResetToken;
import com.englishapp.model.UserAccount;
import com.englishapp.repository.PasswordResetTokenRepository;
import com.englishapp.repository.UserAccountRepository;
import com.englishapp.security.AuthUserPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

@Service
public class AuthService {
    private static final int RESET_TOKEN_BYTES = 32;
    private static final int RESET_TOKEN_VALIDITY_HOURS = 1;

    private final UserAccountRepository userAccountRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordResetEmailService passwordResetEmailService;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;

    public AuthService(
            UserAccountRepository userAccountRepository,
            PasswordResetTokenRepository passwordResetTokenRepository,
            PasswordResetEmailService passwordResetEmailService,
            PasswordEncoder passwordEncoder,
            AuthenticationManager authenticationManager
    ) {
        this.userAccountRepository = userAccountRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.passwordResetEmailService = passwordResetEmailService;
        this.passwordEncoder = passwordEncoder;
        this.authenticationManager = authenticationManager;
    }

    @Transactional
    public Map<String, Object> register(String email, String password) {
        if (userAccountRepository.existsByEmail(email)) {
            throw new IllegalArgumentException("Email already in use");
        }
        UserAccount user = new UserAccount();
        user.setEmail(email.toLowerCase());
        user.setPasswordHash(passwordEncoder.encode(password));
        user.setCreatedAt(Instant.now());
        user = userAccountRepository.save(user);
        return userPayload(user);
    }

    public Map<String, Object> login(String email, String password, HttpServletRequest request) {
        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(email.toLowerCase(), password)
            );
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
            HttpSession session = request.getSession(true);
            // Explicit 6h timeout; server.servlet.session.timeout can be ignored by some setups
            session.setMaxInactiveInterval(6 * 60 * 60);
            session.setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY, context);
            AuthUserPrincipal principal = (AuthUserPrincipal) authentication.getPrincipal();
            UserAccount user = userAccountRepository.findById(principal.getId())
                    .orElseThrow(() -> new NotFoundException("User not found"));
            return userPayload(user);
        } catch (BadCredentialsException exception) {
            throw new IllegalArgumentException("Invalid credentials");
        }
    }

    public void logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        SecurityContextHolder.clearContext();
    }

    public Map<String, Object> me(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthUserPrincipal principal)) {
            throw new SecurityException("Unauthorized");
        }
        UserAccount user = userAccountRepository.findById(principal.getId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        return userPayload(user);
    }

    /** Always returns success message to avoid revealing whether the email exists. */
    @Transactional
    public void requestPasswordReset(String email) {
        String normalized = email == null ? "" : email.trim().toLowerCase();
        if (normalized.isEmpty()) {
            return;
        }
        userAccountRepository.findByEmail(normalized).ifPresent(user -> {
            passwordResetTokenRepository.deleteByUserId(user.getId());
            String token = generateSecureToken();
            PasswordResetToken resetToken = new PasswordResetToken();
            resetToken.setUserId(user.getId());
            resetToken.setToken(token);
            resetToken.setExpiresAt(Instant.now().plusSeconds(RESET_TOKEN_VALIDITY_HOURS * 3600L));
            passwordResetTokenRepository.save(resetToken);
            passwordResetEmailService.sendPasswordResetEmail(user.getEmail(), token);
        });
    }

    public void resetPassword(String token, String newPassword) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Invalid or expired reset link");
        }
        PasswordResetToken resetToken = passwordResetTokenRepository
                .findByTokenAndExpiresAtAfter(token.trim(), Instant.now())
                .orElseThrow(() -> new IllegalArgumentException("Invalid or expired reset link"));
        UserAccount user = userAccountRepository.findById(resetToken.getUserId())
                .orElseThrow(() -> new IllegalArgumentException("Invalid or expired reset link"));
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userAccountRepository.save(user);
        passwordResetTokenRepository.delete(resetToken);
    }

    private static String generateSecureToken() {
        SecureRandom random = new SecureRandom();
        byte[] bytes = new byte[RESET_TOKEN_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private Map<String, Object> userPayload(UserAccount user) {
        return Map.of(
                "id", user.getId(),
                "email", user.getEmail(),
                "timezone", user.getTimezone(),
                "mergeWindowMinutes", user.getMergeWindowMinutes(),
                "weeklyReviewDay", user.getWeeklyReviewDay()
        );
    }
}
