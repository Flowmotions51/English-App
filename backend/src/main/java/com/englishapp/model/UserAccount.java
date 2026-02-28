package com.englishapp.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
@Entity
@Table(name = "users")
public class UserAccount {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(nullable = false)
    private String timezone = "UTC";

    @Column(name = "merge_window_minutes", nullable = false)
    private Integer mergeWindowMinutes = 60;

    @Column(name = "weekly_review_day", nullable = false)
    private Integer weeklyReviewDay = 1;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
