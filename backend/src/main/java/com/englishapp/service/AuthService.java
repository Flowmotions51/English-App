package com.englishapp.service;

import com.englishapp.model.UserAccount;
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

import java.time.Instant;
import java.util.Map;

@Service
public class AuthService {
    private final UserAccountRepository userAccountRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;

    public AuthService(
            UserAccountRepository userAccountRepository,
            PasswordEncoder passwordEncoder,
            AuthenticationManager authenticationManager
    ) {
        this.userAccountRepository = userAccountRepository;
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
