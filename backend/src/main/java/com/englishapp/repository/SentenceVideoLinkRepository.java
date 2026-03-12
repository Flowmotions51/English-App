package com.englishapp.repository;

import com.englishapp.model.SentenceVideoLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface SentenceVideoLinkRepository extends JpaRepository<SentenceVideoLink, Long> {

    @Query("select v from SentenceVideoLink v where v.sentence.id = :sentenceId and v.sentence.sentenceList.user.id = :userId order by v.createdAt")
    List<SentenceVideoLink> findBySentenceIdAndUserId(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId);

    @Query("select v from SentenceVideoLink v where v.id = :linkId and v.sentence.sentenceList.user.id = :userId")
    java.util.Optional<SentenceVideoLink> findByIdAndUserId(@Param("linkId") Long linkId, @Param("userId") Long userId);
}
