package com.englishapp.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;

@Getter
@Setter
@Entity
@Table(name = "pronunciation_attempts")
public class PronunciationAttempt {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "sentence_id", nullable = false)
    private Sentence sentence;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "review_session_id")
    private ReviewSession reviewSession;

    @Column(nullable = false)
    private boolean successful;

    @Column(name = "attempt_number", nullable = false)
    private Integer attemptNumber = 1;

    @Column
    private Integer stage;

    @Column(name = "part_index")
    private Integer partIndex;

    @Column(name = "part_count")
    private Integer partCount;

    @Column(nullable = false, length = 32)
    private String source = "REVIEW";

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
