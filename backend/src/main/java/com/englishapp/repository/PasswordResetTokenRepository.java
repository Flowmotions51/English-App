package com.englishapp.repository;

import com.englishapp.model.PasswordResetToken;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.Optional;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, Long> {
    Optional<PasswordResetToken> findByTokenAndExpiresAtAfter(String token, Instant now);
    void deleteByUserId(Long userId);
    void deleteByExpiresAtBefore(Instant cutoff);
}
